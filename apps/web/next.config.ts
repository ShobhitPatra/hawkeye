import type { NextConfig } from "next";

// The tsconfig path aims tsc at core's TypeScript sources, whose NodeNext ".js" specifiers Turbopack cannot resolve.
const config: NextConfig = {
  reactStrictMode: true,
  turbopack: { resolveAlias: { "@hawkeye/core": "@hawkeye/core/dist/index.js" } },
};
export default config;
