import { readFileSync, writeFileSync } from "node:fs";

const path = "src/db/auth-schema.ts";
const source = readFileSync(path, "utf8");
const rewritten = source.replaceAll(
  /timestamp\("([a-z_]+)"\)/g,
  'timestamp("$1", { withTimezone: true })',
);
if (rewritten === source)
  throw new Error(`${path}: no bare timestamp() calls found; the generated shape changed`);
if (/timestamp\("[^"]+"\)/.test(rewritten))
  throw new Error(`${path}: a timestamp() call was left without withTimezone`);
writeFileSync(path, rewritten);
