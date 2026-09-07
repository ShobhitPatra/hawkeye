import { createProgram } from "./cli.js";
import { progressLine, terminalStyle } from "./terminal.js";

await createProgram({
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  style: terminalStyle({ isTTY: process.stdout.isTTY, env: process.env }),
  stderrStyle: terminalStyle({ isTTY: process.stderr.isTTY, env: process.env }),
  progress: progressLine({
    isTTY: process.stderr.isTTY,
    write: (text) => process.stderr.write(text),
  }),
}).parseAsync(process.argv);
