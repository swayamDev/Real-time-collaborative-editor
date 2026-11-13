DROP INDEX "documents_updated_at_idx";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "documents_live_updated_at_idx" ON "documents" USING btree ("updated_at" DESC NULLS LAST) WHERE "documents"."deleted_at" IS NULL;