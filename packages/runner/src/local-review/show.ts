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
  const resultPath = join(directory, "result.json");
  const raw = await readFile(resultPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT")
      throw new Error(`no review yet: the session has not written ${resultPath}`);
    throw error;
  });
  const result = parseReviewResult(JSON.parse(raw));
  return renderReviewText({ result, meta });
}
