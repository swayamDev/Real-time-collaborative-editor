CREATE TABLE "app_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "share_links" DROP CONSTRAINT "share_links_token_hash_unique";--> statement-breakpoint
ALTER TABLE "share_links" DROP COLUMN "token_hash";