import { afterEach, describe, expect, it } from "vitest";
import { siteUrl } from "./site-url";

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

describe("siteUrl", () => {
  it("returns a URL without a trailing slash unchanged", () => {
    process.env.BETTER_AUTH_URL = "https://hawkeye.example";
    expect(siteUrl()).toBe("https://hawkeye.example");
  });
  it("removes one trailing slash", () => {
    process.env.BETTER_AUTH_URL = "https://hawkeye.example/";
    expect(siteUrl()).toBe("https://hawkeye.example");
  });
  it("removes several trailing slashes", () => {
    process.env.BETTER_AUTH_URL = "https://hawkeye.example///";
    expect(siteUrl()).toBe("https://hawkeye.example");
  });
  it("leaves a slash inside the path alone", () => {
    process.env.BETTER_AUTH_URL = "https://hawkeye.example/app/";
    expect(siteUrl()).toBe("https://hawkeye.example/app");
  });
});
