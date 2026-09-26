import { describe, expect, it } from "vitest";
import { browserOpener, openInBrowser } from "./open-browser.js";

describe("browserOpener", () => {
  it("uses open on macOS and xdg-open on a Linux desktop", () => {
    expect(browserOpener({ platform: "darwin", env: {} })).toBe("open");
    expect(browserOpener({ platform: "linux", env: { DISPLAY: ":0" } })).toBe("xdg-open");
    expect(browserOpener({ platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0" } })).toBe(
      "xdg-open",
    );
  });
  it("opens nothing over SSH, on Linux without a display, or on another platform", () => {
    expect(browserOpener({ platform: "darwin", env: { SSH_CONNECTION: "1 2 3 4" } })).toBe(
      undefined,
    );
    expect(
      browserOpener({ platform: "linux", env: { DISPLAY: ":0", SSH_TTY: "/dev/pts/1" } }),
    ).toBe(undefined);
    expect(browserOpener({ platform: "linux", env: {} })).toBe(undefined);
    expect(browserOpener({ platform: "win32", env: {} })).toBe(undefined);
  });
});

describe("openInBrowser", () => {
  it("reports whether the opener started", async () => {
    await expect(openInBrowser("true", "https://hawkeye.example/connect")).resolves.toBe(true);
    await expect(
      openInBrowser("/nonexistent/hawkeye-opener", "https://hawkeye.example/connect"),
    ).resolves.toBe(false);
  });
});
