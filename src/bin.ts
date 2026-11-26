// The `schem` command of the npm package: one bin for both the CLI and the MCP server.
//
//   schem draw <file> [-o <dir>]        the CLI (src/cli.ts)
//   schem edit <file> --ops <ops.json>  the CLI
//   schem mcp [--root <folder>]         the MCP server on stdin and stdout (src/mcp/main.ts)
//
// scripts/build.ts bundles this file into dist/schem.js. In the repo, `npm run schem` and
// `npm run mcp` still run src/cli.ts and src/mcp/main.ts directly.
//
// `schem --help` comes from src/cli-ui.ts and already lists the MCP server and its tools, so
// this file adds nothing to it. Output is styled only on a terminal (see processIo in src/cli.ts).

import { processIo, run } from "./cli.js";
import { main as mcpMain } from "./mcp/main.js";

const argv = process.argv.slice(2);
const [command, ...rest] = argv;

if (command === "mcp") {
  // The server owns stdout for JSON-RPC, so it starts here, before the CLI is involved.
  const code = mcpMain(rest);
  if (code !== 0) process.exitCode = code;
} else {
  process.exitCode = run(argv, processIo(argv));
}
