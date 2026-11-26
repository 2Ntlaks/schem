# Agent Report: Pure CLI and MCP Tool Conversion (`neon/cli-only`)

## Branch and Commits

- Branch: `neon/cli-only`
- Base commit before merge: `77f562e`
- Landed branch: `t3/d0f0a63e` (fast-forward merge to `ed08fde`)
- New commits on `neon/cli-only`:
  - `104abd8` - `chore: remove web playground and focus repo on CLI and MCP`
  - `9d7c18d` - `feat(cli): add init --template and watch command with debounce`
  - Plus the report commit adding `docs/agent-reports/neon-cli-only.md`.

## What Was Done

1. **Merged CLI and MCP polish branch `t3/d0f0a63e`:**
   - Fast-forwarded `neon/cli-only` to `t3/d0f0a63e` via `git merge --no-edit t3/d0f0a63e`.
   - Kept the 12th MCP (Model Context Protocol) tool (`schem_import`), the CLI (command line interface) `describe --alt-text` flag, `skills/schem/SKILL.md`, `docs/install.md`, and their unit tests in `tests/mcp.test.ts` and `tests/dsl-cli.test.ts`.

2. **Removed the web playground cleanly:**
   - Deleted `web/`, `scripts/web.ts`, `scripts/lib/web-bundle.ts`, `scripts/lib/docs-page.ts`, `.github/workflows/pages.yml`, and `tests/web.test.ts`.
   - Updated `package.json`: set `"typecheck"` to `"tsc --noEmit"` and removed `"web:build"` and `"web:serve"`. Left `dependencies` and `devDependencies` unchanged.
   - Updated `.github/workflows/ci.yml`: removed `- run: npm run web:build`.
   - Updated `tests/integration-sprint.test.ts`: removed the `webDraw` import and browser playground assertion while keeping all `layout()`, `toSvg()`, and CLI `draw` dark theme checks intact.
   - Updated `README.md`, `CONTRIBUTING.md`, and `docs/README.md` to describe `schem` strictly as a pure CLI and 12-tool MCP tool, removing all playground instructions, URLs, and `web/` references.
   - Cleaned up stale playground and browser comments in `scripts/build.ts`, `src/core/sha256.ts`, `src/modules/files.ts`, and `src/text/font-file.ts` while preserving `REWRITES` in `scripts/build.ts`.

3. **Added CLI ergonomics (`schem init --template` and `schem watch`):**
   - Created `src/cli-templates.ts` exporting `INIT_TEMPLATES`, `INIT_TEMPLATE_NAMES`, and `getInitTemplate(name)` with 6 verified `.schem` text DSL (domain-specific language) templates: `led`, `divider`, `opamp`, `regulator`, `i2c`, and `bjt-amp`.
   - Updated `src/cli.ts`:
     - Extended `init [name] [--template <name>]` (default template `led`). Passing an unknown `--template` exits with code `2` and lists all valid template names.
     - Added `watch <file> [-o <dir>] [--theme <name>] [--transparent]` backed by `node:fs` `watch()` with a 150 ms debounce. It runs an initial draw, redraws SVG (Scalable Vector Graphics) and PNG (Portable Network Graphics) on file edits, prints clear errors to stderr without crashing on invalid intermediate edits, and cleans up on `SIGINT` and `SIGTERM`.
     - Exported `watchFile(file, options)` returning a `WatchHandle` with `close()` and `drawCount` so tests can drive file watching directly without spawning long-lived OS processes.
     - Updated `USAGE` while keeping `npm run schem -- draw examples/led.schem.json` and the single `function isEntryPoint(): boolean {` definition intact.
   - Updated `skills/schem/SKILL.md` (98 lines, under the 150-line limit) to document `schem init --template` and `schem watch`.
   - Added `tests/cli-ergonomics.test.ts` covering all 6 templates (compiling, laying out `valid`, and checking 0 overlaps), unknown `--template` exit code `2` with valid template listing, and `watchFile()` initial render, invalid intermediate edit recovery, valid redraw, and clean `close()`.

4. **Visual inspection of template drawings:**
   - Rendered temporary PNGs for all 6 init templates (`led`, `divider`, `opamp`, `regulator`, `i2c`, `bjt-amp`) and opened every PNG to inspect the drawings.
   - On the first pass of `opamp`, naming the input net `VIN` caused the engine to draw `VIN` as a supply rail symbol and float the input header above the resistor. Renaming the signal nets to `IN` and `OUT` produced a clean left-to-right textbook inverting amplifier (`J1 IN -> R1 -> U1 TL072` with `R2` arching above to `J2 OUT`).
   - Removed the temporary `out/_tmp_templates/` directory after inspection.

## Files Changed

### Added
- `src/cli-templates.ts`
- `tests/cli-ergonomics.test.ts`
- `docs/agent-reports/neon-cli-only.md`
- `docs/agent-reports/neon-mcp-import-docs.md` (from merging `t3/d0f0a63e`)

### Modified
- `.github/workflows/ci.yml`
- `CONTRIBUTING.md`
- `README.md`
- `docs/README.md`
- `docs/install.md` (from `t3/d0f0a63e`)
- `package.json`
- `scripts/build.ts`
- `skills/schem/SKILL.md`
- `src/bin.ts` (from `t3/d0f0a63e`)
- `src/cli.ts`
- `src/core/sha256.ts`
- `src/mcp/commands.ts` (from `t3/d0f0a63e`)
- `src/mcp/server.ts` (from `t3/d0f0a63e`)
- `src/mcp/tools.ts` (from `t3/d0f0a63e`)
- `src/modules/files.ts`
- `src/text/font-file.ts`
- `tests/dsl-cli.test.ts` (from `t3/d0f0a63e`)
- `tests/integration-sprint.test.ts`
- `tests/mcp.test.ts` (from `t3/d0f0a63e`)

### Deleted
- `.github/workflows/pages.yml`
- `scripts/lib/docs-page.ts`
- `scripts/lib/web-bundle.ts`
- `scripts/web.ts`
- `tests/web.test.ts`
- `web/` (all 14 files)

## Commands Run and Results

Note: `npm ci` was run once in the fresh git worktree to install existing lockfile dependencies without changing `package.json` or `package-lock.json`.

### 1. Stale playground reference check

Command: `git grep -i "playground\|web:build\|web:serve" -- ':!docs/agent-reports' ':!phase0' ':!baselines'`

Exit code: `1` (0 matches found).

### 2. `npm run typecheck`

Exit code: `0`

```text
> schem-cli@0.0.1 typecheck
> tsc --noEmit
```

### 3. `npm test`

Exit code: `0`

```text
> schem-cli@0.0.1 test
> vitest run

 Test Files  39 passed (39)
      Tests  778 passed (778)
   Start at  16:45:53
   Duration  19.35s (transform 6.62s, setup 0ms, collect 43.65s, tests 98.28s, environment 27ms, prepare 20.05s)
```

All 39 test files passed, including `tests/cli-ergonomics.test.ts` (9 tests), `tests/cli.test.ts` (12 tests), `tests/dsl-cli.test.ts` (9 tests), `tests/integration-sprint.test.ts` (6 tests), and `tests/mcp.test.ts` (24 tests).

### 4. `npm run phase0`

Exit code: `0`

```text
case                           status                             verifier  overlaps conv read ms
case01-led                     valid                              valid     0        0    0    95
case02-divider-buffer          valid                              valid     0        0    0    31
case03-summing                 valid                              valid     0        0    0    12
case04-hbridge                 valid                              valid     0        0    0    111
case05-i2c                     valid                              valid     0        0    0    8
case06-esp32-relay             valid                              valid     0        0    0    11
case07-two-ic-decoupling       valid                              valid     0        0    0    11
case08-diffpair                valid                              valid     0        0    0    6
```

All 8 validation cases stayed `valid` with 0 overlaps, 0 convention findings, and 0 readability findings. All 12 validation edit scripts matched expected status and passed gate 4 stability checks.

### 5. `npm run build`

Exit code: `0`

```text
> schem-cli@0.0.1 build
> tsx scripts/build.ts

wrote dist/schem.js (595 KB) and dist/fonts/; external: @resvg/resvg-js, opentype.js
```

### 6. `npm run pack:smoke`

Exit code: `0`

```text
> schem-cli@0.0.1 pack:smoke
> tsx scripts/pack-smoke.ts

  ok 1  npm pack: schem-cli-0.0.1.tgz, 562.2 kB packed, 1446.1 kB unpacked, 28 files
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
pack:smoke passed: schem-cli-0.0.1.tgz, 562.2 kB, 28 files
```

## Skipped or Not Applicable

- `npm run bench -- --check` was not needed because `src/layout/` was not touched.
- Held-out test paths (`phase0/cases/test/`, `phase0/cases/edits/case11-*`, `baselines/LOG-test.md`, `baselines/out/*/test/`, `baselines/out/_netlist/test/`) and `--test` flags were never opened, listed, read, or run.
- `marked` remains in `devDependencies` because `package.json` dependencies and devDependencies were left unchanged as instructed.

## Open Questions

None.
