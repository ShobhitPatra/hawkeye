import { createProgram } from "./cli.js";
import { browserOpener, openInBrowser } from "./runner/open-browser.js";
import { progressLine, terminalStyle } from "./terminal.js";

const interactive = process.stderr.isTTY === true;
const opener = interactive
  ? browserOpener({ platform: process.platform, env: process.env })
  : undefined;

await createProgram({
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  style: terminalStyle({ isTTY: process.stdout.isTTY, env: process.env }),
  stderrStyle: terminalStyle({ isTTY: process.stderr.isTTY, env: process.env }),
  progress: progressLine({
    isTTY: process.stderr.isTTY,
    write: (text) => process.stderr.write(text),
  }),
  interactive,
  ...(opener === undefined ? {} : { openBrowser: (url: string) => openInBrowser(opener, url) }),
}).parseAsync(process.argv);
