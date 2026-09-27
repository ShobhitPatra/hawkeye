import { readFileSync, writeFileSync } from "node:fs";
import { npmReadme } from "../src/readme.js";

const root = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
writeFileSync(new URL("../README.md", import.meta.url), npmReadme(root));
