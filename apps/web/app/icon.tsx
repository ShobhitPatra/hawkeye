import { readFileSync } from "node:fs";

export const contentType = "image/svg+xml";

export default function Icon() {
  return new Response(
    readFileSync(new URL("../../../.claude/skills/hawkeye-design/favicon.svg", import.meta.url)),
    { headers: { "content-type": contentType } },
  );
}
