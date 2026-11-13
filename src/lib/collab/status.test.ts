import { describe, expect, it } from "vitest";
import { STATUS_LABELS, type StatusInputs, computeStatus } from "./status";

const now = 100_000;
const base: StatusInputs = {
  terminal: null,
  halted: false,
  online: true,
  socketSynced: true,
  everSyncedThisTab: true,
  unwrittenSince: null,
  flushing: false,
  oldestUnackedAt: null,
  now,
};

const status = (patch: Partial<StatusInputs>) => computeStatus({ ...base, ...patch });

describe("computeStatus", () => {
  it("is Saved when connected and everything is acknowledged", () => {
    expect(status({})).toBe("saved");
  });

  it("puts terminal states and halt first", () => {
    expect(status({ terminal: "deleted", halted: true, online: false })).toBe("deleted");
    expect(status({ terminal: "not-found" })).toBe("not-found");
    expect(status({ halted: true, online: false, unwrittenSince: 0 })).toBe("halted");
  });

  it("shows Saving only when a device write is over a second late", () => {
    expect(status({ unwrittenSince: now - 200 })).toBe("saved");
    expect(status({ unwrittenSince: now - 1_000 })).toBe("saving");
    expect(status({ unwrittenSince: now - 1_000, online: false })).toBe("saving");
  });

  it("is Saved on this device whenever the browser is offline and writes are done", () => {
    expect(status({ online: false, socketSynced: false })).toBe("saved-on-device");
    expect(status({ online: false, socketSynced: false, everSyncedThisTab: false })).toBe("saved-on-device");
  });

  it("is Connecting before the first sync in this tab", () => {
    expect(status({ socketSynced: false, everSyncedThisTab: false })).toBe("connecting");
  });

  it("says edits are safe on the device while reconnecting, when they are", () => {
    expect(status({ socketSynced: false })).toBe("reconnecting-local");
    expect(STATUS_LABELS["reconnecting-local"]).toBe("Reconnecting. Saved on this device.");
    // A write still in progress (under a second) means not everything is on the device yet.
    expect(status({ socketSynced: false, unwrittenSince: now - 100 })).toBe("reconnecting");
  });

  it("is Syncing while the offline queue is sent and verified", () => {
    expect(status({ flushing: true })).toBe("syncing");
    expect(status({ flushing: true, oldestUnackedAt: now - 5_000 })).toBe("syncing");
  });

  it("is Saving when a live acknowledgement is over a second late", () => {
    expect(status({ oldestUnackedAt: now - 999 })).toBe("saved");
    expect(status({ oldestUnackedAt: now - 1_000 })).toBe("saving");
  });

  it("has the approved copy", () => {
    expect(STATUS_LABELS).toMatchObject({
      saved: "Saved",
      saving: "Saving",
      connecting: "Connecting",
      reconnecting: "Reconnecting",
      syncing: "Syncing",
      "saved-on-device": "Saved on this device",
    });
  });
});
