import { createProgram } from "./cli.js";

await createProgram({
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
}).parseAsync(process.argv);
