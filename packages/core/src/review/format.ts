import type { Severity } from "../contract/schema.js";

export const SEVERITY_BADGE: Record<Severity, string> = {
  must_fix: "must-fix",
  should_fix: "should-fix",
  optional: "optional",
  inherited: "inherited",
};

export function indentLines(text: string, indent: string): string[] {
  return text.split("\n").map((line) => (line === "" ? "" : `${indent}${line}`));
}
