import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { documentMembers } from "@/db/schema";
import { getAccess } from "@/server/authz";
import { NOT_ALLOWED, NO_SUCH_DOCUMENT } from "@/server/guards";
import { shareLinkToken } from "@/server/share-link-token";
import { claimInvites, getSharing, inviteByEmail, joinByLink, setShareLink } from "@/server/sharing";
import { type World, as, makeUser, makeWorld } from "./fixtures";
import { syncCalls } from "./mocks";

vi.mock("@/server/session", async () => (await import("./mocks")).sessionModule());
vi.mock("next/cache", async () => (await import("./mocks")).cacheModule());
vi.mock("next/navigation", async () => (await import("./mocks")).navigationModule());
vi.mock("@/server/sync", async () => (await import("./mocks")).syncModule());
vi.mock("@/server/email", () => ({ sendEmail: async () => {} }));

const { changeRoleAction, getSharingAction, inviteAction, removeMemberAction, setShareLinkAction } = await import(
  "@/app/share-actions"
);

let world: World;
beforeEach(async () => {
  world = await makeWorld();
  syncCalls.length = 0;
});

async function membership(userId: string) {
  const [row] = await db()
    .select()
    .from(documentMembers)
    .where(and(eq(documentMembers.documentId, world.documentId), eq(documentMembers.userId, userId)));
  return row;
}

async function linkToken(): Promise<string> {
  const url = (await getSharing(world.documentId)).link.url!;
  return url.split("/").at(-1)!;
}

describe("share actions are owner only", () => {
  it("refuses editors, viewers and strangers", async () => {
    for (const [person, error] of [
      [world.editor, NOT_ALLOWED],
      [world.viewer, NOT_ALLOWED],
      [world.stranger, NO_SUCH_DOCUMENT],
    ] as const) {
      as(person);
      expect(await getSharingAction(world.documentId)).toEqual({ ok: false, error });
      expect(await inviteAction(world.documentId, "x@example.test", "editor")).toEqual({ ok: false, error });
      expect(await changeRoleAction(world.documentId, world.viewer.id, "editor")).toEqual({ ok: false, error });
      expect(await removeMemberAction(world.documentId, world.viewer.id)).toEqual({ ok: false, error });
      expect(await setShareLinkAction(world.documentId, true, "editor")).toEqual({ ok: false, error });
    }
    expect((await getAccess(world.viewer.id, world.documentId))?.role).toBe("viewer");
  });

  it("lets the owner change roles and remove people, bumping access versions and telling the sync server", async () => {
    as(world.owner);
    const before = (await membership(world.viewer.id)).accessVersion;
    expect(await changeRoleAction(world.documentId, world.viewer.id, "editor")).toMatchObject({ ok: true });
    expect(await membership(world.viewer.id)).toMatchObject({ role: "editor", accessVersion: before + 1 });
    expect(await removeMemberAction(world.documentId, world.viewer.id)).toMatchObject({ ok: true });
    expect(await membership(world.viewer.id)).toMatchObject({ role: "none", accessVersion: before + 2 });
    expect(await getAccess(world.viewer.id, world.documentId)).toBeNull();
    expect(syncCalls.map((call) => call.call)).toEqual(["access", "access"]);
  });
});

describe("invites", () => {
  it("adds an existing account at once, matching email case and spaces", async () => {
    const bob = await makeUser("bob");
    as(world.owner);
    const result = await inviteByEmail(world.documentId, world.owner, `  ${bob.email.toUpperCase()} `, "viewer");
    expect(result).toMatchObject({ ok: true, kind: "member" });
    expect((await getAccess(bob.id, world.documentId))?.role).toBe("viewer");
  });

  it("keeps an invite for an unknown email and applies it on first sign-in", async () => {
    const email = `new-${Date.now()}@Example.TEST`;
    expect(await inviteByEmail(world.documentId, world.owner, ` ${email} `, "editor")).toMatchObject({
      ok: true,
      kind: "invited",
    });
    expect((await getSharing(world.documentId)).invites.map((invite) => invite.email)).toContain(email.toLowerCase());

    const newcomer = await makeUser("newcomer");
    const claimed = await claimInvites(newcomer.id, `  ${email.toUpperCase()}`);
    expect(claimed).toHaveLength(1);
    expect((await getAccess(newcomer.id, world.documentId))?.role).toBe("editor");
    expect((await getSharing(world.documentId)).invites).toEqual([]);
  });

  it("refuses invalid emails and the owner's own address", async () => {
    expect(await inviteByEmail(world.documentId, world.owner, "not an email", "viewer")).toMatchObject({ ok: false });
    expect(await inviteByEmail(world.documentId, world.owner, world.owner.email, "viewer")).toEqual({
      ok: false,
      error: "You already own this document.",
    });
  });
});

describe("share link", () => {
  it("grants the link role to someone new, and stops working when turned off", async () => {
    await setShareLink(world.documentId, { enabled: true, role: "viewer" });
    const token = await linkToken();
    expect(await joinByLink(world.documentId, token, world.stranger.id)).toMatchObject({ ok: true });
    expect(await membership(world.stranger.id)).toMatchObject({ role: "viewer", source: "link" });

    const changes = await setShareLink(world.documentId, { enabled: false, role: "viewer" });
    expect(changes).toEqual([expect.objectContaining({ userId: world.stranger.id, role: null })]);
    expect(await getAccess(world.stranger.id, world.documentId)).toBeNull();
    expect(await joinByLink(world.documentId, token, world.stranger.id)).toEqual({ ok: false });
  });

  it("issues a new token when turned on again, so old links never work", async () => {
    await setShareLink(world.documentId, { enabled: true, role: "viewer" });
    const first = await linkToken();
    await setShareLink(world.documentId, { enabled: false, role: "viewer" });
    await setShareLink(world.documentId, { enabled: true, role: "viewer" });
    expect(await linkToken()).not.toBe(first);
    expect(await joinByLink(world.documentId, first, world.stranger.id)).toEqual({ ok: false });
    expect(await joinByLink(world.documentId, shareLinkToken(world.documentId, 999), world.stranger.id)).toEqual({
      ok: false,
    });
  });

  it("never lowers an existing role", async () => {
    await setShareLink(world.documentId, { enabled: true, role: "viewer" });
    const before = await membership(world.editor.id);
    expect(await joinByLink(world.documentId, await linkToken(), world.editor.id)).toEqual({ ok: true, change: null });
    expect(await membership(world.editor.id)).toEqual(before);
  });

  it("raises a link member when the link role goes up, and lowers them when it goes down", async () => {
    await setShareLink(world.documentId, { enabled: true, role: "viewer" });
    await joinByLink(world.documentId, await linkToken(), world.stranger.id);
    await setShareLink(world.documentId, { enabled: true, role: "editor" });
    expect((await membership(world.stranger.id)).role).toBe("editor");
  });

  it("an explicit invite turns a link membership into an invite, which survives turning the link off", async () => {
    await setShareLink(world.documentId, { enabled: true, role: "viewer" });
    await joinByLink(world.documentId, await linkToken(), world.stranger.id);
    expect((await membership(world.stranger.id)).source).toBe("link");

    await inviteByEmail(world.documentId, world.owner, world.stranger.email, "editor");
    expect(await membership(world.stranger.id)).toMatchObject({ role: "editor", source: "invite" });

    await setShareLink(world.documentId, { enabled: false, role: "viewer" });
    expect((await getAccess(world.stranger.id, world.documentId))?.role).toBe("editor");
  });

  it("brings a removed member back only with the link role", async () => {
    as(world.owner);
    await removeMemberAction(world.documentId, world.editor.id);
    await setShareLink(world.documentId, { enabled: true, role: "viewer" });
    await joinByLink(world.documentId, await linkToken(), world.editor.id);
    expect(await membership(world.editor.id)).toMatchObject({ role: "viewer", source: "link" });
  });
});
