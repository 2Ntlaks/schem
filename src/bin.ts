// The `schem` command of the npm package: one bin for both the CLI and the MCP server.
//
//   schem draw <file> [-o <dir>]        the CLI (src/cli.ts)
//   schem edit <file> --ops <ops.json>  the CLI
//   schem mcp [--root <folder>]         the MCP server on stdin and stdout (src/mcp/main.ts)
//
// scripts/build.ts bundles this file into dist/schem.js. In the repo, `npm run schem` and
// `npm run mcp` still run src/cli.ts and src/mcp/main.ts directly.

import { run } from "./cli.js";
import { main as mcpMain } from "./mcp/main.js";

const MCP_LINE = `
MCP server (for AI agents):
  schem mcp [--root <folder>]...   serve the 12 schem tools on stdin and stdout
  schem mcp --help                 more about the server
  Tools: schem_create, schem_edit, schem_check, schem_preview, schem_query,
         schem_render (supports theme and transparent), schem_undo,
         schem_describe (includes verified altText), schem_fmt,
         schem_components, schem_component, schem_import`;

const argv = process.argv.slice(2);
const [command, ...rest] = argv;

if (command === "mcp") {
  const code = mcpMain(rest);
  if (code !== 0) process.exitCode = code;
} else {
  const help = command === undefined || command === "--help" || command === "-h" || command === "help";
  process.exitCode = run(argv, {
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  });
  if (help) process.stdout.write(`${MCP_LINE}\n`);
}
