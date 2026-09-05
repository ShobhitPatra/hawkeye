ALTER TABLE "review_posted" ALTER COLUMN "github_review_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "detail" text;