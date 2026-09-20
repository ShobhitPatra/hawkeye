import { describe, expect, it } from "vitest";
import { adminLogins, isAdmin } from "./admin";

describe("isAdmin", () => {
  it("lets nobody in when the setting is missing or empty", () => {
    expect(isAdmin("octocat", undefined)).toBe(false);
    expect(isAdmin("octocat", "")).toBe(false);
    expect(isAdmin("octocat", " , ")).toBe(false);
  });

  it("matches a listed login whatever its case or spacing", () => {
    expect(isAdmin("OctoCat", "hubot, octocat ")).toBe(true);
    expect(isAdmin("hubot", "hubot,octocat")).toBe(true);
    expect(isAdmin("mallory", "hubot,octocat")).toBe(false);
  });

  it("refuses a session without a login", () => {
    expect(isAdmin(undefined, "octocat")).toBe(false);
    expect(isAdmin(null, "octocat")).toBe(false);
    expect(isAdmin("", "octocat")).toBe(false);
  });

  it("parses the list once, lowercased", () => {
    expect([...adminLogins("A, b,,C")]).toEqual(["a", "b", "c"]);
  });
});
