CREATE TABLE "document_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_invites_document_email_unique" UNIQUE("document_id","email"),
	CONSTRAINT "document_invites_role_check" CHECK ("document_invites"."role" IN ('editor', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "document_members" (
	"document_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"source" text NOT NULL,
	"access_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_members_document_id_user_id_pk" PRIMARY KEY("document_id","user_id"),
	CONSTRAINT "document_members_role_check" CHECK ("document_members"."role" IN ('editor', 'viewer', 'none')),
	CONSTRAINT "document_members_source_check" CHECK ("document_members"."source" IN ('invite', 'link'))
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"role" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "share_links_role_check" CHECK ("share_links"."role" IN ('editor', 'viewer'))
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "owner_id" text;--> statement-breakpoint
-- Documents from before accounts need an owner. Create a seed user only when
-- such documents exist (local development), so a fresh database gets none.
-- `pnpm db:claim-local --email you@example.com` moves them to a real account.
INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
SELECT 'seed-local-owner', 'Local seed user', 'seed@brahma.local', true, now(), now()
WHERE EXISTS (SELECT 1 FROM "documents" WHERE "owner_id" IS NULL)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "documents" SET "owner_id" = 'seed-local-owner' WHERE "owner_id" IS NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "document_invites" ADD CONSTRAINT "document_invites_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_invites" ADD CONSTRAINT "document_invites_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_members" ADD CONSTRAINT "document_members_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_members" ADD CONSTRAINT "document_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_invites_email_idx" ON "document_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "document_members_user_idx" ON "document_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_owner_idx" ON "documents" USING btree ("owner_id");