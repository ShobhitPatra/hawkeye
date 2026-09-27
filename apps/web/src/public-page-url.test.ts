import { describe, expect, it } from "vitest";
import { publicPageUrl } from "./public-page-url";

describe("publicPageUrl", () => {
  it("drops the query and the fragment and keeps the path", () => {
    expect(
      publicPageUrl("https://hawkeye.reviews/?returnTo=%2Fprs%2Focto%2Fsecret%2F12#start"),
    ).toBe("https://hawkeye.reviews/");
    expect(publicPageUrl("https://hawkeye.reviews/privacy")).toBe(
      "https://hawkeye.reviews/privacy",
    );
  });
});
