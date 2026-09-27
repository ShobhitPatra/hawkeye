import { HAWKEYE_REPOSITORY_URL } from "@hawkeye/core";

const FILES = `${HAWKEYE_REPOSITORY_URL}/blob/main`;
const RAW = `${HAWKEYE_REPOSITORY_URL.replace("https://github.com/", "https://raw.githubusercontent.com/")}/main`;
const GENERATED =
  "<!-- Generated from the repository's README.md by `pnpm readme`; edit that file instead. -->";

function absolute(path: string, base: string): string {
  return /^(https?:|mailto:|#)/.test(path) ? path : `${base}/${path}`;
}

export function npmReadme(readme: string): string {
  const body = readme
    .replace(
      /(src|srcset)="([^"]+)"/g,
      (_, attribute: string, path: string) => `${attribute}="${absolute(path, RAW)}"`,
    )
    .replace(/href="([^"]+)"/g, (_, path: string) => `href="${absolute(path, FILES)}"`)
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+)\)/g,
      (_, alt: string, path: string) => `![${alt}](${absolute(path, RAW)})`,
    )
    .replace(/(?<!!\[[^\]]*)\]\(([^)\s]+)\)/g, (_, path: string) => `](${absolute(path, FILES)})`);
  return `${GENERATED}\n\n${body}`;
}
