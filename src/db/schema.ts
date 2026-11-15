import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

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
 * snapshot of its content (the sync server holds the live copy). Every
 * document has exactly one owner; other people get access through
 * document_members.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull().default(""),
    yjsState: bytea("yjs_state").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Tombstone. Set first when a document is deleted, so every reader (the
     * list, the page, the sync server, clients returning from offline) sees
     * the deletion even if a later cleanup step fails. The same update
     * empties title and yjs_state, so a deleted document keeps no content;
     * the sync server never writes to a tombstoned row.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("documents_live_updated_at_idx").on(table.updatedAt.desc()).where(sql`${table.deletedAt} IS NULL`),
    index("documents_owner_idx").on(table.ownerId),
  ],
);

export type DocumentRow = typeof documents.$inferSelect;

/** Roles a member can hold. The owner is documents.owner_id, never a member row. */
export type MemberRole = "editor" | "viewer";

/**
 * Access for people other than the owner, one row per person and document.
 *
 * Rows are never deleted: removing someone sets role "none". Every access
 * change increments access_version, and sync tokens carry the version they
 * were issued at, so the sync server can refuse or cap a token issued
 * before the latest change without comparing clocks.
 *
 * source records how access was granted. Turning a share link off removes
 * only "link" rows; an explicit invite converts a "link" row to "invite".
 */
export const documentMembers = pgTable(
  "document_members",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<MemberRole | "none">().notNull(),
    source: text("source").$type<"invite" | "link">().notNull(),
    accessVersion: integer("access_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.userId] }),
    index("document_members_user_idx").on(table.userId),
    check("document_members_role_check", sql`${table.role} IN ('editor', 'viewer', 'none')`),
    check("document_members_source_check", sql`${table.source} IN ('invite', 'link')`),
  ],
);

/** Invites to emails without an account yet; claimed on first sign-in with that verified email. */
export const documentInvites = pgTable(
  "document_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** Trimmed and lowercased. */
    email: text("email").notNull(),
    role: text("role").$type<MemberRole>().notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("document_invites_document_email_unique").on(table.documentId, table.email),
    index("document_invites_email_idx").on(table.email),
    check("document_invites_role_check", sql`${table.role} IN ('editor', 'viewer')`),
  ],
);

/**
 * One share link per document. The link's token is not stored: it is an
 * HMAC of "document id:version" under a server secret, so the owner can copy
 * the link at any time, a database leak alone reveals no working link, and
 * turning the link on again bumps the version so old links stop working.
 */
export const shareLinks = pgTable(
  "share_links",
  {
    documentId: uuid("document_id")
      .primaryKey()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    role: text("role").$type<MemberRole>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("share_links_role_check", sql`${table.role} IN ('editor', 'viewer')`)],
);

/** Fixed-window counters for limits Better Auth does not cover (invites, sync tokens, per-email sign-in). */
export const appRateLimits = pgTable("app_rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});
