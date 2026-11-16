import { describe, expect, it } from "vitest";
import { type DeviceTitle, type TitleOverride, pickTitle, withKnownTitles } from "./document-titles";

const at = (iso: string) => Date.parse(iso);
const row = (id: string, title: string, updatedAt = "2026-11-17T10:00:00.000Z") => ({ id, title, updatedAt, role: "owner" as const });

describe("the sidebar's titles (issue #2)", () => {
  it("shows the open document's live title, whatever the server says", () => {
    const live: TitleOverride = { title: "Typing now", at: at("2026-11-17T09:00:00Z"), live: true };
    expect(pickTitle(row("a", "Old"), live)).toBe("Typing now");
  });

  it("keeps a rename made here while the server has not caught up (the Untitled flash)", () => {
    const renamed: TitleOverride = { title: "Older", at: at("2026-11-17T10:00:05Z"), live: false };
    expect(pickTitle(row("a", ""), renamed)).toBe("Older");
  });

  it("uses the title saved on this device after a reload, until the server catches up", () => {
    const saved: DeviceTitle = { title: "Older", titleChangedAt: at("2026-11-17T10:00:05Z") };
    expect(pickTitle(row("a", ""), undefined, saved)).toBe("Older");
  });

  it("lets a newer rename from another browser win over an older title here", () => {
    // Renamed here at 10:00:05; renamed elsewhere later, snapshotted at 10:02.
    const server = row("a", "Renamed elsewhere", "2026-11-17T10:02:00.000Z");
    const renamedHere: TitleOverride = { title: "Mine", at: at("2026-11-17T10:00:05Z"), live: false };
    const savedHere: DeviceTitle = { title: "Mine", titleChangedAt: at("2026-11-17T10:00:05Z") };
    expect(pickTitle(server, renamedHere, savedHere)).toBe("Renamed elsewhere");
  });

  it("takes the most recent of the titles known here", () => {
    const override: TitleOverride = { title: "Second", at: at("2026-11-17T10:00:09Z"), live: false };
    const device: DeviceTitle = { title: "First", titleChangedAt: at("2026-11-17T10:00:05Z") };
    expect(pickTitle(row("a", ""), override, device)).toBe("Second");
  });

  it("ignores a device record with no change time (written before this fix)", () => {
    expect(pickTitle(row("a", "Server"), undefined, { title: "Device" })).toBe("Server");
  });

  it("never adds a row the server did not return, so a revoked or deleted document cannot reappear", () => {
    const server = [row("kept", "Kept", "2026-01-01T00:00:00.000Z")];
    const overrides = new Map<string, TitleOverride>([["revoked", { title: "Revoked", at: Date.now(), live: true }]]);
    const device = new Map<string, DeviceTitle>([
      ["deleted", { title: "Deleted", titleChangedAt: Date.now() }],
      ["kept", { title: "Kept, renamed", titleChangedAt: Date.now() }],
    ]);
    const result = withKnownTitles(server, overrides, device);
    expect(result.map((document) => document.id)).toEqual(["kept"]);
    expect(result[0].title).toBe("Kept, renamed");
  });

  it("keeps the server's order and leaves untouched rows as they are", () => {
    const server = [row("b", "B"), row("a", "A")];
    const result = withKnownTitles(server, new Map(), new Map());
    expect(result).toEqual(server);
    expect(result[0]).toBe(server[0]);
  });
});
