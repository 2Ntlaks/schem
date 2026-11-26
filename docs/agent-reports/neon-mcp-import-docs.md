# Agent Report: MCP SPICE Import, CLI Alt-Text Flag, and Docs Update

## Branch and Worktree

- Branch: `t3/d0f0a63e`
- Worktree path: `C:/Users/ntlak/.t3/worktrees/Schematic circuit/t3-d0f0a63e-1c5cdd3fb71f11c9`
- Commits:
  - `484e67c` - `feat(mcp): add schem_import tool and update MCP help`
  - `9013943` - `feat(cli): add --alt-text flag to describe command`
  - `a285fb9` - `docs: add themes and spice-import to docs page, update SKILL and install guide`
  - `5a4b523` - `test: cover schem_import MCP tool and CLI describe --alt-text`
  - Plus the report commit adding this file (`docs/agent-reports/neon-mcp-import-docs.md`).

## What Was Done

1. **MCP `schem_import` tool and help updates** (`src/mcp/commands.ts`, `src/mcp/tools.ts`, `src/mcp/server.ts`, `src/bin.ts`):
   - Implemented `schem_import` (`{ path: string, spice: string, detail?: "brief" | "normal" | "full" }`) in `src/mcp/commands.ts`. It validates arguments and the 2 MB input size guard, checks root confinement and exclusive creation via `resolvePath(roots, path, "create")`, runs `importSpice(spice)`, checks project limits via `guardProject`, validates and lays out the circuit via `drawProject`, commits `.schem` or `.schem.json` via `commitProject` and `exclusiveCreate` inside `withLock`, and returns `status`, `verified`, `saved`, `path`, `revision`, `layoutToken`, `warnings`, `counts`, and `findings` (plus `metrics` for `detail: "full"`).
   - Exposed `schem_import` as the 12th tool in `TOOLS` in `src/mcp/tools.ts`, and updated `schem_render` and `schem_describe` descriptions to mention `theme`, `transparent`, and verified `altText`.
   - Updated `INSTRUCTIONS` and `HELP` in `src/mcp/server.ts` and `MCP_LINE` in `src/bin.ts` to list all 12 MCP tools, `schem_import`, `theme`/`transparent` on `schem_render`, and `altText` on `schem_describe`.

2. **CLI `describe --alt-text` flag** (`src/cli.ts`):
   - Added `"alt-text"` to `SHARED.describe.flags` and updated `USAGE` (`describe <file> [--table] [--alt-text]`) while keeping `npm run schem -- draw examples/led.schem.json` intact.
   - In plain-text mode, passing `--alt-text` prints only the verified `altText` line (ready to pipe into Markdown or blog posts). Under `--json`, the full JSON payload (including `altText`) is preserved.

3. **Playground docs page, agent skill, and install guide** (`scripts/lib/docs-page.ts`, `skills/schem/SKILL.md`, `docs/install.md`):
   - Added `docs/themes.md` ("Rendering themes") and `docs/spice-import.md` ("Importing SPICE netlists") to `SECTIONS` in `scripts/lib/docs-page.ts`.
   - Updated `skills/schem/SKILL.md` (97 lines, under the 150-line limit) and `docs/install.md` to document all 12 MCP tools (including `schem_import`), rendering themes (`--theme`, `--transparent`), `schem import`, `describe --alt-text`, and the packaged docs `themes.md` and `spice-import.md`.

4. **Tests** (`tests/mcp.test.ts`, `tests/dsl-cli.test.ts`):
   - Updated the `tools/list` contract assertion and stdio test in `tests/mcp.test.ts` to all 12 tools, and added a `schem_import` stdio call.
   - Added unit tests for `schem_import` covering `.schem` and `.schem.json` output, matching `revision` and `layoutToken` on `schem_check`, exclusive-create overwrite protection, `detail` modes (`brief`, `normal`, `full`), root and junction confinement, invalid inputs, unparseable SPICE decks, 2 MB size guard, and the 500-part guard.
   - Added a CLI test in `tests/dsl-cli.test.ts` verifying `describe --alt-text` in plain-text mode, with `--table --alt-text`, and with `--json`.

## Files Changed

- `src/mcp/commands.ts`
- `src/mcp/tools.ts`
- `src/mcp/server.ts`
- `src/bin.ts`
- `src/cli.ts`
- `scripts/lib/docs-page.ts`
- `skills/schem/SKILL.md`
- `docs/install.md`
- `tests/mcp.test.ts`
- `tests/dsl-cli.test.ts`
- `docs/agent-reports/neon-mcp-import-docs.md`

## Verification

Note: `npm ci` was run once in the fresh worktree to install existing lockfile dependencies without modifying `package.json` or `package-lock.json`.

### 1. `npm run typecheck`

Exit code: `0`

```text
> schem-cli@0.0.1 typecheck
> tsc --noEmit && tsc --noEmit -p web
```

### 2. `npm test`

Exit code: `0`

```text
> schem-cli@0.0.1 test
> vitest run

 Test Files  39 passed (39)
      Tests  782 passed (782)
   Start at  16:21:43
   Duration  19.76s (transform 9.69s, setup 0ms, collect 43.21s, tests 104.08s, environment 25ms, prepare 22.36s)
```

All 39 test files passed, including `tests/mcp.test.ts` (24 tests), `tests/dsl-cli.test.ts` (9 tests), `tests/web.test.ts` (13 tests, verifying all `docs.html` anchors, external `https://` links, and valid playground circuits), `tests/cli.test.ts` (12 tests), and `tests/integration-sprint.test.ts` (6 tests).

### 3. `npm run phase0`

Exit code: `0`

```text
> schem-cli@0.0.1 phase0
> tsx scripts/phase0.ts

case                           status                             verifier  overlaps conv read ms
case01-led                     valid                              valid     0        0    0    157
case02-divider-buffer          valid                              valid     0        0    0    56
case03-summing                 valid                              valid     0        0    0    17
case04-hbridge                 valid                              valid     0        0    0    179
case05-i2c                     valid                              valid     0        0    0    14
case06-esp32-relay             valid                              valid     0        0    0    18
case07-two-ic-decoupling       valid                              valid     0        0    0    20
case08-diffpair                valid                              valid     0        0    0    8
```

All 8 validation cases passed as `valid` with 0 overlaps, 0 convention findings, and 0 readability findings. All 12 validation edit scripts matched expected status and passed gate 4 stability checks.

### 4. `npm run web:build`

Exit code: `0`

```text
> schem-cli@0.0.1 web:build
> tsx scripts/web.ts build

wrote out\web/ (main.js 40 KB, worker.js 441 KB, docs.js 1 KB)
```

### 5. `npm run build`

Exit code: `0`

```text
> schem-cli@0.0.1 build
> tsx scripts/build.ts

wrote dist/schem.js (589 KB) and dist/fonts/; external: @resvg/resvg-js, opentype.js
```

### 6. `npm run pack:smoke`

Exit code: `0`

```text
> schem-cli@0.0.1 pack:smoke
> tsx scripts/pack-smoke.ts

  ok 1  npm pack: schem-cli-0.0.1.tgz, 560.8 kB packed, 1439.5 kB unpacked, 28 files
  ok 2  npm install <tarball> into an empty project: node_modules/.bin/schem exists
  ok 3  schem --version: 0.0.1
  ok 4  installed: draw led, esp32-relay, summing-amp: SVG and PNG byte-identical to the repo's
  ok 5  installed: mcp initialize: serverInfo schem 0.0.1, same instructions as the repo
  ok 6  installed: mcp tools/list: schem_create, schem_edit, schem_check, schem_preview, schem_query, schem_render, schem_undo, schem_describe, schem_fmt, schem_components, schem_component, schem_import, identical to the repo
  ok 7  installed: mcp schem_create (status valid, same revision and layoutToken) then schem_render: SVG byte-identical to the repo's server
  ok 8  npx --package <tarball> schem --version in an empty folder: 0.0.1
  ok 9  npx <package> --version, without naming the command: 0.0.1 (npx runs the one bin, schem)
  ok 10  npx: draw led, esp32-relay, summing-amp: SVG and PNG byte-identical to the repo's
  ok 11  npx: mcp initialize: serverInfo schem 0.0.1, same instructions as the repo
  ok 12  npx: mcp tools/list: schem_create, schem_edit, schem_check, schem_preview, schem_query, schem_render, schem_undo, schem_describe, schem_fmt, schem_components, schem_component, schem_import, identical to the repo
  ok 13  npx: mcp schem_create (status valid, same revision and layoutToken) then schem_render: SVG byte-identical to the repo's server
  ok 14  npm install -g . from the clone (temporary prefix): schem --version 0.0.1
  ok 15  clone install (npm install -g .): draw led, esp32-relay, summing-amp: SVG and PNG byte-identical to the repo's
pack:smoke passed: schem-cli-0.0.1.tgz, 560.8 kB, 28 files
```

## Skipped or Not Applicable

- No PNG files were created or modified in the repository, so no PNG visual inspection was required.
- `npm run bench -- --check` was not needed because `src/layout/` was not modified.
- Held-out test paths and `--test` flags were not touched or run.

## Open Questions

None.
