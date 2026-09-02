import { readFileSync, writeFileSync } from "node:fs";

const path = "src/db/auth-schema.ts";
const source = readFileSync(path, "utf8");
writeFileSync(
  path,
  source.replaceAll(/timestamp\("([a-z_]+)"\)/g, 'timestamp("$1", { withTimezone: true })'),
);
