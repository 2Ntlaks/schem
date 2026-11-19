// stdio entry for the MCP server. Protocol lines go to stdout and nothing else does.
// Logs go to stderr (SPEC 11.2).

import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HELP, createSession, handleMessage, rootsLabel, serverArgs } from "./server.js";

function isEntryPoint(): boolean {
  const arg = process.argv[1];
  if (arg === undefined) return false;
  return resolve(fileURLToPath(import.meta.url)) === resolve(arg);
}

/** Start the server. Returns a process code when it should exit, or keeps running on stdin. */
export function main(argv: string[]): number {
  const args = serverArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.error !== undefined) {
    process.stderr.write(`${args.error}\n`);
    process.stderr.write(HELP);
    return 2;
  }
  let session;
  try {
    session = createSession(args.roots);
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }
  process.stderr.write(`schem mcp: roots ${rootsLabel(session)}\n`);
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    const out = handleMessage(session, line);
    if (out !== undefined) process.stdout.write(`${out}\n`);
  });
  return 0;
}

if (isEntryPoint()) {
  const code = main(process.argv.slice(2));
  if (code !== 0) process.exitCode = code;
}
