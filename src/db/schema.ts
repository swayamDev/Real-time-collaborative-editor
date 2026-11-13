import { customType, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Postgres bytea, exposed to the app as a Uint8Array (what Yjs works with). */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  },
  fromDriver(value) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  },
});

/**
 * One row per document.
 *
 * `yjs_state` is the encoded Yjs update for the whole document and is the
 * source of truth for its content. `owner_id` and `workspace_id` arrive with
 * auth in Phase 3 as nullable columns, which is an additive migration.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull().default(""),
    yjsState: bytea("yjs_state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("documents_updated_at_idx").on(table.updatedAt.desc())],
);

export type DocumentRow = typeof documents.$inferSelect;
