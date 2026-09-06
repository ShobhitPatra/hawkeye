import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@hawkeye/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@/": new URL("./apps/web/src/", import.meta.url).pathname,
    },
  },
  test: { include: ["packages/*/src/**/*.test.ts", "apps/*/{src,app}/**/*.test.ts"] },
});
