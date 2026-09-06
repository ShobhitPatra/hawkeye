import { createProgram } from "./cli.js";
import { terminalStyle } from "./terminal.js";

await createProgram({
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  style: terminalStyle({ isTTY: process.stdout.isTTY, env: process.env }),
}).parseAsync(process.argv);
