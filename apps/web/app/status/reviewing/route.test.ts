import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /status/reviewing", () => {
  it("serves an uncached animated svg naming the runner", async () => {
    const response = GET(new Request("https://hawkeye.test/status/reviewing?runner=laptop"));
    expect(response.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const svg = await response.text();
    expect(svg).toContain("Reviewing on laptop");
    expect(svg).toContain("@keyframes sweep");
    expect(svg).not.toContain("<animateTransform");
  });
  it("falls back to a generic name and caps the length", async () => {
    expect(await GET(new Request("https://hawkeye.test/status/reviewing")).text()).toContain(
      "Reviewing on your runner",
    );
    const long = await GET(
      new Request(`https://hawkeye.test/status/reviewing?runner=${"x".repeat(200)}`),
    ).text();
    expect(long).toContain(`Reviewing on ${"x".repeat(64)}<`);
  });
});
