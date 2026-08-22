CREATE TYPE "public"."finding_severity" AS ENUM('must_fix', 'should_fix', 'inherited');--> statement-breakpoint
CREATE TYPE "public"."job_state" AS ENUM('queued', 'claimed', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'ok', 'max-turns', 'timeout', 'error', 'invalid-output');--> statement-breakpoint
CREATE TABLE "armed_pr" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"number" integer NOT NULL,
	"quiet_window_s" integer,
	"armed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disarmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "finding" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"armed_pr_id" text NOT NULL,
	"stable_id" text NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"claim" text NOT NULL,
	"path" text,
	"line" integer,
	"first_seen_sha" text NOT NULL,
	"resolved_sha" text,
	"github_comment_id" text
);
--> statement-breakpoint
CREATE TABLE "installation" (
	"id" text PRIMARY KEY NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installation_user" (
	"installation_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "installation_user_installation_id_user_id_pk" PRIMARY KEY("installation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"armed_pr_id" text NOT NULL,
	"head_sha" text NOT NULL,
	"base_sha" text NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"state" "job_state" DEFAULT 'queued' NOT NULL,
	"claimed_by_runner_id" text,
	"claimed_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_posted" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"armed_pr_id" text NOT NULL,
	"head_sha" text NOT NULL,
	"github_review_id" text NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"runner_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL,
	"error" text,
	"stream_path" text
);
--> statement-breakpoint
CREATE TABLE "runner" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runner_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"prompt_override" text,
	"max_turns" integer DEFAULT 40 NOT NULL,
	"wall_clock_min" integer DEFAULT 15 NOT NULL,
	"quiet_window_s" integer DEFAULT 180 NOT NULL,
	"review_drafts" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "armed_pr" ADD CONSTRAINT "armed_pr_installation_id_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_armed_pr_id_armed_pr_id_fk" FOREIGN KEY ("armed_pr_id") REFERENCES "public"."armed_pr"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installation_user" ADD CONSTRAINT "installation_user_installation_id_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_armed_pr_id_armed_pr_id_fk" FOREIGN KEY ("armed_pr_id") REFERENCES "public"."armed_pr"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_claimed_by_runner_id_runner_id_fk" FOREIGN KEY ("claimed_by_runner_id") REFERENCES "public"."runner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_posted" ADD CONSTRAINT "review_posted_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_posted" ADD CONSTRAINT "review_posted_armed_pr_id_armed_pr_id_fk" FOREIGN KEY ("armed_pr_id") REFERENCES "public"."armed_pr"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_runner_id_runner_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "armed_pr_active_unique" ON "armed_pr" USING btree ("user_id","owner","repo","number") WHERE "armed_pr"."disarmed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "finding_stable_per_armed_pr" ON "finding" USING btree ("armed_pr_id","stable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_open_per_armed_pr" ON "job" USING btree ("armed_pr_id") WHERE "job"."state" = 'queued';--> statement-breakpoint
CREATE UNIQUE INDEX "review_posted_per_head" ON "review_posted" USING btree ("armed_pr_id","head_sha");