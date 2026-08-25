import { z } from "zod";

export const LENSES = [
  "intent",
  "behavior",
  "blast_radius",
  "verification",
  "fit",
  "hygiene",
] as const;
export type Lens = (typeof LENSES)[number];

export const SEVERITIES = ["must_fix", "should_fix", "optional", "inherited"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const VERDICTS = ["ship", "mergeable", "changes_needed", "blocked"] as const;
export type Verdict = (typeof VERDICTS)[number];

const LEGACY_VERDICTS: Record<string, Verdict> = { revise: "changes_needed", hold: "blocked" };

const FindingSchema = z
  .object({
    path: z.string().min(1).optional(),
    line: z.number().int().positive().optional(),
    side: z.enum(["RIGHT", "LEFT"]).optional(),
    severity: z.enum(SEVERITIES),
    claim: z.string().min(1),
    detail: z.string().min(1),
    rationale: z.string().min(1).optional(),
    suggestion: z.string().optional(),
  })
  .refine((f) => f.line === undefined || f.path !== undefined, { message: "line requires path" })
  .refine((f) => f.suggestion === undefined || f.line !== undefined, {
    message: "suggestion requires line",
  });

export const ReviewResultSchema = z.object({
  verdict: z.preprocess(
    (value) => (typeof value === "string" ? (LEGACY_VERDICTS[value] ?? value) : value),
    z.enum(VERDICTS),
  ),
  summary: z.string().min(1),
  lenses: z
    .array(z.object({ name: z.enum(LENSES), assessment: z.string().min(1) }))
    .refine(
      (l) => l.length === LENSES.length && new Set(l.map((x) => x.name)).size === LENSES.length,
      { message: "lenses must list each of the six lenses exactly once" },
    ),
  findings: z.array(FindingSchema),
});

export type Finding = z.infer<typeof FindingSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export function verdictFor(findings: readonly Finding[]): Verdict {
  const severities = new Set(findings.map((finding) => finding.severity));
  if (severities.has("must_fix")) return "blocked";
  if (severities.has("should_fix")) return "changes_needed";
  if (severities.size > 0) return "mergeable";
  return "ship";
}

export function parseReviewResult(raw: unknown): ReviewResult {
  const parsed = ReviewResultSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `Invalid review result: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  return { ...parsed.data, verdict: verdictFor(parsed.data.findings) };
}
