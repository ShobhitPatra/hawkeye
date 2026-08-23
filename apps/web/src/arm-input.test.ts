import { describe, expect, it } from "vitest";
import { parseArmInput, parsePullRequestInput } from "./arm-input";

function formData(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const valid = { owner: "octo-cat", repo: "hawk.eye_1", number: "42", installationId: "10" };

describe("parseArmInput", () => {
  it("reads owner, repo, number and installation", () => {
    expect(parseArmInput(formData(valid))).toEqual({
      owner: "octo-cat",
      repo: "hawk.eye_1",
      number: 42,
      installationId: "10",
    });
  });

  it("rejects an owner outside the name charset", () => {
    expect(() => parseArmInput(formData({ ...valid, owner: "octo/cat" }))).toThrow("invalid owner");
  });

  it("rejects a repo outside the name charset", () => {
    expect(() => parseArmInput(formData({ ...valid, repo: "re po" }))).toThrow("invalid repo");
  });

  it("rejects a non-integer number", () => {
    expect(() => parseArmInput(formData({ ...valid, number: "4.2" }))).toThrow("invalid number");
  });

  it("rejects a zero number", () => {
    expect(() => parseArmInput(formData({ ...valid, number: "0" }))).toThrow("invalid number");
  });

  it("rejects a negative number", () => {
    expect(() => parseArmInput(formData({ ...valid, number: "-1" }))).toThrow("invalid number");
  });

  it("rejects a number beyond the postgres integer range", () => {
    expect(() => parseArmInput(formData({ ...valid, number: "2147483648" }))).toThrow(
      "invalid number",
    );
  });

  it("rejects a huge digit string", () => {
    expect(() => parseArmInput(formData({ ...valid, number: "1".padEnd(22, "0") }))).toThrow(
      "invalid number",
    );
  });

  it("rejects a non-numeric installation", () => {
    expect(() => parseArmInput(formData({ ...valid, installationId: "ten" }))).toThrow(
      "invalid installationId",
    );
  });

  it("rejects missing fields", () => {
    expect(() => parseArmInput(formData({}))).toThrow("invalid number");
  });
});

describe("parsePullRequestInput", () => {
  it("ignores the installation", () => {
    expect(parsePullRequestInput(formData({ owner: "octo", repo: "repo", number: "7" }))).toEqual({
      owner: "octo",
      repo: "repo",
      number: 7,
    });
  });
});
