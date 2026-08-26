import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseReviewResult, renderReviewText } from "@hawkeye/core";
import type { RoundMeta } from "./prepare.js";

function parseRoundMeta(raw: unknown, path: string): RoundMeta {
  const meta = raw as Partial<RoundMeta> | null;
  if (
    typeof meta !== "object" ||
    meta === null ||
    !Number.isInteger(meta.round) ||
    typeof meta.headSha !== "string" ||
    meta.headSha === ""
  )
    throw new Error(`${path} is not a round meta file: round and headSha are required`);
  return meta as RoundMeta;
}

export async function showRound(directory: string): Promise<string> {
  const metaPath = join(directory, "meta.json");
  const meta = parseRoundMeta(JSON.parse(await readFile(metaPath, "utf8")), metaPath);
  const result = parseReviewResult(
    JSON.parse(await readFile(join(directory, "result.json"), "utf8")),
  );
  return renderReviewText({ result, meta });
}
