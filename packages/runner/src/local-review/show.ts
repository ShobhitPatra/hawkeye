import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseReviewResult, renderReviewText } from "@hawkeye/core";
import type { RoundMeta } from "./prepare.js";

export async function showRound(directory: string): Promise<string> {
  const meta = JSON.parse(await readFile(join(directory, "meta.json"), "utf8")) as RoundMeta;
  const result = parseReviewResult(
    JSON.parse(await readFile(join(directory, "result.json"), "utf8")),
  );
  return renderReviewText({ result, meta });
}
