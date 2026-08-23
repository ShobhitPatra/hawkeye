export interface PullRequestInput {
  owner: string;
  repo: string;
  number: number;
}

export interface ArmInput extends PullRequestInput {
  installationId: string;
}

const namePattern = /^[A-Za-z0-9._-]+$/;
const digitsPattern = /^[0-9]+$/;

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

export function parsePullRequestInput(formData: FormData): PullRequestInput {
  const number = Number(readDigits(formData, "number"));
  if (number === 0) throw new Error("invalid number");
  return { owner: readName(formData, "owner"), repo: readName(formData, "repo"), number };
}

export function parseArmInput(formData: FormData): ArmInput {
  return {
    ...parsePullRequestInput(formData),
    installationId: readDigits(formData, "installationId"),
  };
}
