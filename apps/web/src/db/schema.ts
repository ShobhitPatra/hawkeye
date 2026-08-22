import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

export * from "./auth-schema.js";

export const jobState = pgEnum("job_state", ["queued", "claimed", "done", "failed"]);
export const runStatus = pgEnum("run_status", [
  "running",
  "ok",
  "max-turns",
  "timeout",
  "error",
  "invalid-output",
]);
export const findingSeverity = pgEnum("finding_severity", ["must_fix", "should_fix", "inherited"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

export const installation = pgTable("installation", {
  id: text("id").primaryKey(),
  accountLogin: text("account_login").notNull(),
  accountType: text("account_type").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
});

export const installationUser = pgTable(
  "installation_user",
  {
    installationId: text("installation_id")
      .notNull()
      .references(() => installation.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
  },
  (t) => [primaryKey({ columns: [t.installationId, t.userId] })],
);

export const armedPr = pgTable(
  "armed_pr",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    installationId: text("installation_id")
      .notNull()
      .references(() => installation.id),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    number: integer("number").notNull(),
    quietWindowSeconds: integer("quiet_window_s"),
    armedAt: timestamp("armed_at", { withTimezone: true }).notNull().defaultNow(),
    disarmedAt: timestamp("disarmed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("armed_pr_active_unique")
      .on(t.userId, t.owner, t.repo, t.number)
      .where(sql`${t.disarmedAt} is null`),
  ],
);

export const runner = pgTable("runner", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ...timestamps,
});

export const job = pgTable(
  "job",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    armedPrId: text("armed_pr_id")
      .notNull()
      .references(() => armedPr.id),
    headSha: text("head_sha").notNull(),
    baseSha: text("base_sha").notNull(),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull(),
    state: jobState("state").notNull().default("queued"),
    claimedByRunnerId: text("claimed_by_runner_id").references(() => runner.id),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("job_open_per_armed_pr")
      .on(t.armedPrId)
      .where(sql`${t.state} = 'queued'`),
  ],
);

export const run = pgTable("run", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  jobId: text("job_id")
    .notNull()
    .references(() => job.id),
  runnerId: text("runner_id")
    .notNull()
    .references(() => runner.id),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  status: runStatus("status").notNull().default("running"),
  turns: integer("turns").notNull().default(0),
  error: text("error"),
  streamPath: text("stream_path"),
});

export const finding = pgTable(
  "finding",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    armedPrId: text("armed_pr_id")
      .notNull()
      .references(() => armedPr.id),
    stableId: text("stable_id").notNull(),
    severity: findingSeverity("severity").notNull(),
    claim: text("claim").notNull(),
    path: text("path"),
    line: integer("line"),
    firstSeenSha: text("first_seen_sha").notNull(),
    resolvedSha: text("resolved_sha"),
    githubCommentId: text("github_comment_id"),
  },
  (t) => [uniqueIndex("finding_stable_per_armed_pr").on(t.armedPrId, t.stableId)],
);

export const reviewPosted = pgTable(
  "review_posted",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    runId: text("run_id")
      .notNull()
      .references(() => run.id),
    armedPrId: text("armed_pr_id")
      .notNull()
      .references(() => armedPr.id),
    headSha: text("head_sha").notNull(),
    githubReviewId: text("github_review_id").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("review_posted_per_head").on(t.armedPrId, t.headSha)],
);

export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  promptOverride: text("prompt_override"),
  maxTurns: integer("max_turns").notNull().default(40),
  wallClockMinutes: integer("wall_clock_min").notNull().default(15),
  quietWindowSeconds: integer("quiet_window_s").notNull().default(180),
  reviewDrafts: boolean("review_drafts").notNull().default(false),
});
