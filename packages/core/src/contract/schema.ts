import { z } from "zod";

export const DIMENSIONS = [
  "necessity",
  "correctness",
  "tests",
  "conventions",
  "side_effects",
  "parity",
  "governance",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

const FindingSchema = z
  .object({
    path: z.string().min(1).optional(),
    line: z.number().int().positive().optional(),
    side: z.enum(["RIGHT", "LEFT"]).optional(),
    class: z.enum(["blocking", "polish", "pre_existing"]),
    claim: z.string().min(1),
    detail: z.string().min(1),
    suggestion: z.string().optional(),
  })
  .refine((f) => f.line === undefined || f.path !== undefined, { message: "line requires path" })
  .refine((f) => f.suggestion === undefined || f.line !== undefined, {
    message: "suggestion requires line",
  });

export const ReviewResultSchema = z.object({
  verdict: z.enum(["ready", "needs-work", "blocking"]),
  summary: z.string().min(1),
  dimensions: z
    .array(z.object({ name: z.enum(DIMENSIONS), assessment: z.string().min(1) }))
    .refine(
      (d) =>
        d.length === DIMENSIONS.length && new Set(d.map((x) => x.name)).size === DIMENSIONS.length,
      {
        message: "dimensions must list each of the seven dimensions exactly once",
      },
    ),
  findings: z.array(FindingSchema),
});

export type Finding = z.infer<typeof FindingSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export function parseReviewResult(raw: unknown): ReviewResult {
  const parsed = ReviewResultSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `Invalid review result: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  return parsed.data;
}
