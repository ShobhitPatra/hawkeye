ALTER TABLE "user_settings" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "harness" text DEFAULT 'claude-code' NOT NULL;