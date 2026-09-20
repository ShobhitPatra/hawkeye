ALTER TABLE "runner" ADD COLUMN "first_seen_at" timestamp with time zone;--> statement-breakpoint
UPDATE "runner" SET "first_seen_at" = "last_seen_at" WHERE "last_seen_at" IS NOT NULL;