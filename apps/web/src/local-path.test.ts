import { describe, expect, it } from "vitest";
import { localPath } from "./local-path";

describe("localPath", () => {
  it("keeps a same-origin path", () => {
    expect(localPath("/connect?code=AAAA-BBBB")).toBe("/connect?code=AAAA-BBBB");
    expect(localPath("/")).toBe("/");
  });
  it("drops anything that could leave the origin", () => {
    for (const value of ["//evil.com", "/\\evil.com", "https://evil.com", "connect", "", undefined])
      expect(localPath(value)).toBeUndefined();
  });
});
