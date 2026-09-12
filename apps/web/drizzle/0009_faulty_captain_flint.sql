ALTER TYPE "public"."run_status" ADD VALUE 'superseded';--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "quiet_window_s" SET DEFAULT 0;