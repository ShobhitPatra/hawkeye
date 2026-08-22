import { describe, expect, it } from "vitest";
import { parsePullRequestReference } from "./pull-request-reference.js";

describe("parsePullRequestReference", () => {
  it("parses a github.com pull URL", () => {
    expect(parsePullRequestReference("https://github.com/ShobhitPatra/hawkeye/pull/12")).toEqual({
      owner: "ShobhitPatra",
      repo: "hawkeye",
      number: 12,
    });
  });
  it("parses a URL with trailing path or query", () => {
    expect(parsePullRequestReference("https://github.com/o/r/pull/3/files?diff=split")).toEqual({
      owner: "o",
      repo: "r",
      number: 3,
    });
  });
  it("parses owner/repo#number", () => {
    expect(parsePullRequestReference("o/r#7")).toEqual({ owner: "o", repo: "r", number: 7 });
  });
  it("rejects shell metacharacters in owner and repo", () => {
    for (const bad of [
      "https://github.com/o/r'x/pull/1",
      "o/r'x#1",
      "https://github.com/o$(id)/r/pull/1",
      "o;rm/r#1",
    ]) {
      expect(() => parsePullRequestReference(bad)).toThrow(/pull request reference/);
    }
  });
  it("rejects issues URLs, other hosts and garbage", () => {
    for (const bad of [
      "https://github.com/o/r/issues/1",
      "https://gitlab.com/o/r/pull/1",
      "o/r",
      "pull/1",
      "",
    ]) {
      expect(() => parsePullRequestReference(bad)).toThrow(/pull request reference/);
    }
  });
});
