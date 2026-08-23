import type { PullRequestReference } from "@hawkeye/core";

const namePattern = /^[A-Za-z0-9._-]+$/;
const digitsPattern = /^[0-9]+$/;

const MAX_POSTGRES_INT = 2147483647;

function readName(formData: FormData, field: string) {
  const value = formData.get(field);
  if (typeof value !== "string" || !namePattern.test(value)) {
    throw new Error(`invalid ${field}`);
  }
  return value;
}

function readDigits(formData: FormData, field: string) {
  const value = formData.get(field);
  if (typeof value !== "string" || !digitsPattern.test(value)) {
    throw new Error(`invalid ${field}`);
  }
  return value;
}

function readPullRequestNumber(formData: FormData) {
  const number = Number(readDigits(formData, "number"));
  if (!Number.isSafeInteger(number) || number <= 0 || number > MAX_POSTGRES_INT) {
    throw new Error("invalid number");
  }
  return number;
}

export function parsePullRequestInput(formData: FormData): PullRequestReference {
  const number = readPullRequestNumber(formData);
  return { owner: readName(formData, "owner"), repo: readName(formData, "repo"), number };
}

export function parseArmInput(
  formData: FormData,
): PullRequestReference & { installationId: string } {
  return {
    ...parsePullRequestInput(formData),
    installationId: readDigits(formData, "installationId"),
  };
}
