import type { PullRequestReference } from "@hawkeye/core";

const namePattern = /^[A-Za-z0-9._-]+$/;
const digitsPattern = /^[0-9]+$/;

const MAX_POSTGRES_INT = 2147483647;

function parseName(field: string, value: unknown) {
  if (typeof value !== "string" || !namePattern.test(value)) {
    throw new Error(`invalid ${field}`);
  }
  return value;
}

function parseDigits(field: string, value: unknown) {
  if (typeof value !== "string" || !digitsPattern.test(value)) {
    throw new Error(`invalid ${field}`);
  }
  return value;
}

function parseNumber(value: unknown) {
  const number = Number(parseDigits("number", value));
  if (!Number.isSafeInteger(number) || number <= 0 || number > MAX_POSTGRES_INT) {
    throw new Error("invalid number");
  }
  return number;
}

export function parsePullRequestInput(formData: FormData): PullRequestReference {
  return parsePullRequestParams({
    owner: formData.get("owner"),
    repo: formData.get("repo"),
    number: formData.get("number"),
  });
}

export function parsePullRequestParams(params: {
  owner: unknown;
  repo: unknown;
  number: unknown;
}): PullRequestReference {
  const number = parseNumber(params.number);
  return { owner: parseName("owner", params.owner), repo: parseName("repo", params.repo), number };
}

export function parseArmInput(
  formData: FormData,
): PullRequestReference & { installationId: string } {
  return {
    ...parsePullRequestInput(formData),
    installationId: parseDigits("installationId", formData.get("installationId")),
  };
}
