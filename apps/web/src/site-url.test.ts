import { afterEach, describe, expect, it, vi } from "vitest";
import { siteUrl } from "./site-url";

afterEach(() => vi.unstubAllEnvs());

describe("siteUrl", () => {
  it("returns a URL without a trailing slash unchanged", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://hawkeye.example");
    expect(siteUrl()).toBe("https://hawkeye.example");
  });
  it("removes one trailing slash", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://hawkeye.example/");
    expect(siteUrl()).toBe("https://hawkeye.example");
  });
  it("removes several trailing slashes", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://hawkeye.example///");
    expect(siteUrl()).toBe("https://hawkeye.example");
  });
  it("leaves a slash inside the path alone", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://hawkeye.example/app/");
    expect(siteUrl()).toBe("https://hawkeye.example/app");
  });
});
