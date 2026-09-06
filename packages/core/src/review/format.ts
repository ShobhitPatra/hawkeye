import type { Lens, Severity, Verdict } from "../contract/schema.js";

export const SEVERITY_BADGE: Record<Severity, string> = {
  must_fix: "must-fix",
  should_fix: "should-fix",
  optional: "optional",
  inherited: "inherited",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  must_fix: "Must fix",
  should_fix: "Should fix",
  optional: "Optional",
  inherited: "Inherited",
};

export const VERDICT_LABELS: Record<Verdict, string> = {
  ship: "Ship",
  mergeable: "Mergeable",
  changes_needed: "Changes needed",
  blocked: "Blocked",
};

export const LENS_LABELS: Record<Lens, string> = {
  intent: "Intent",
  behavior: "Behavior",
  blast_radius: "Blast radius",
  verification: "Verification",
  fit: "Fit",
  hygiene: "Hygiene",
};

export function indentLines(text: string, indent: string): string[] {
  return text.split("\n").map((line) => (line === "" ? "" : `${indent}${line}`));
}
