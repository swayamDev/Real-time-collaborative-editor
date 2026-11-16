import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { createDocument } from "@/server/documents";
import { PostgresSnapshotStore } from "../../workers/sync/src/store";
import { makeUser } from "./fixtures";

// The sync server's own Postgres store, against the real schema.
const store = () => new PostgresSnapshotStore(process.env.DATABASE_URL!);

describe("PostgresSnapshotStore.load", () => {
  it("reports no demo expiry for a real document", async () => {
    const owner = await makeUser("owner");
    const document = await createDocument(owner.id, "Plans");
    const loaded = await store().load(document.id);
    expect(loaded).toMatchObject({ deleted: false, title: "Plans", demoExpiresAt: null });
  });

  it("reports a demo document's expiry, to the millisecond", async () => {
    const owner = await makeUser("demo-owner");
    const document = await createDocument(owner.id);
    const expires = new Date(Date.now() + 30 * 60 * 1000);
    await db().update(documents).set({ demoExpiresAt: expires }).where(eq(documents.id, document.id));
    const loaded = await store().load(document.id);
    expect(loaded).toMatchObject({ deleted: false, demoExpiresAt: expires.getTime() });
  });
});
