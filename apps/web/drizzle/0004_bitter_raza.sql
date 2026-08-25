CREATE TABLE "runner_login" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"device_secret_hash" text NOT NULL,
	"runner_name" text NOT NULL,
	"user_id" text,
	"runner_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runner_login_code_unique" UNIQUE("code"),
	CONSTRAINT "runner_login_device_secret_hash_unique" UNIQUE("device_secret_hash")
);
--> statement-breakpoint
ALTER TABLE "runner_login" ADD CONSTRAINT "runner_login_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_login" ADD CONSTRAINT "runner_login_runner_id_runner_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runner"("id") ON DELETE no action ON UPDATE no action;