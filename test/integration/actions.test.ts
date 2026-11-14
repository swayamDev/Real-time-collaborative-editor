import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { getAccess } from "@/server/authz";
import { NOT_ALLOWED, NO_SUCH_DOCUMENT, SIGN_IN_REQUIRED } from "@/server/guards";
import { type World, as, makeWorld } from "./fixtures";
import { syncCalls } from "./mocks";

// Hoisted above the imports, so the factories load the helpers themselves.
vi.mock("@/server/session", async () => (await import("./mocks")).sessionModule());
vi.mock("next/cache", async () => (await import("./mocks")).cacheModule());
vi.mock("next/navigation", async () => (await import("./mocks")).navigationModule());
vi.mock("@/server/sync", async () => (await import("./mocks")).syncModule());

const { createDocumentAction, createDocumentCopyAction, deleteDocumentAction, renameDocumentAction } = await import(
  "@/app/actions"
);

let world: World;
beforeEach(async () => {
  world = await makeWorld();
  syncCalls.length = 0;
});

async function isDeleted(id: string): Promise<boolean> {
  const [row] = await db().select({ deletedAt: documents.deletedAt }).from(documents).where(eq(documents.id, id));
  return row?.deletedAt !== null;
}

describe("getAccess", () => {
  it("knows each role, and nothing for strangers", async () => {
    expect((await getAccess(world.owner.id, world.documentId))?.role).toBe("owner");
    expect((await getAccess(world.editor.id, world.documentId))?.role).toBe("editor");
    expect((await getAccess(world.viewer.id, world.documentId))?.role).toBe("viewer");
    expect(await getAccess(world.stranger.id, world.documentId)).toBeNull();
  });
});

describe("renameDocumentAction", () => {
  it("lets the owner and editors rename", async () => {
    for (const person of [world.owner, world.editor]) {
      as(person);
      expect(await renameDocumentAction(world.documentId, `By ${person.name}`)).toMatchObject({ ok: true });
    }
    expect(syncCalls.filter((call) => call.call === "rename")).toHaveLength(2);
  });

  it("refuses viewers, strangers and signed-out callers without touching the sync server", async () => {
    as(world.viewer);
    expect(await renameDocumentAction(world.documentId, "No")).toEqual({ ok: false, error: NOT_ALLOWED });
    as(world.stranger);
    expect(await renameDocumentAction(world.documentId, "No")).toEqual({ ok: false, error: NO_SUCH_DOCUMENT });
    as(null);
    expect(await renameDocumentAction(world.documentId, "No")).toEqual({ ok: false, error: SIGN_IN_REQUIRED });
    expect(syncCalls).toEqual([]);
  });

  it("treats malformed ids like missing documents", async () => {
    as(world.owner);
    for (const id of ["not-a-uuid", 42, null, { id: world.documentId }]) {
      expect(await renameDocumentAction(id, "x")).toEqual({ ok: false, error: NO_SUCH_DOCUMENT });
    }
  });
});

describe("deleteDocumentAction", () => {
  it("lets only the owner delete", async () => {
    for (const [person, error] of [
      [world.editor, NOT_ALLOWED],
      [world.viewer, NOT_ALLOWED],
      [world.stranger, NO_SUCH_DOCUMENT],
      [null, SIGN_IN_REQUIRED],
    ] as const) {
      as(person);
      expect(await deleteDocumentAction(world.documentId)).toEqual({ ok: false, error });
    }
    expect(await isDeleted(world.documentId)).toBe(false);

    as(world.owner);
    expect(await deleteDocumentAction(world.documentId)).toEqual({ ok: true, value: undefined });
    expect(await isDeleted(world.documentId)).toBe(true);
    expect(syncCalls.map((call) => call.call)).toEqual(["delete"]);
  });

  it("gives nobody access to a deleted document, owner included", async () => {
    as(world.owner);
    await deleteDocumentAction(world.documentId);
    expect(await getAccess(world.owner.id, world.documentId)).toBeNull();
    expect((await getAccess(world.owner.id, world.documentId, { includeDeleted: true }))?.deleted).toBe(true);
    as(world.owner);
    expect(await renameDocumentAction(world.documentId, "x")).toEqual({ ok: false, error: NO_SUCH_DOCUMENT });
  });
});

describe("creating documents", () => {
  it("requires a session and makes the caller the owner", async () => {
    as(null);
    await expect(createDocumentAction()).rejects.toThrow("redirect:/sign-in");
    expect(await createDocumentCopyAction("Copy")).toEqual({ ok: false, error: SIGN_IN_REQUIRED });

    as(world.stranger);
    const copy = await createDocumentCopyAction("Copy");
    expect(copy.ok).toBe(true);
    if (copy.ok) expect((await getAccess(world.stranger.id, copy.value.id))?.role).toBe("owner");
    await expect(createDocumentAction()).rejects.toThrow(/^redirect:\/d\//);
  });
});
