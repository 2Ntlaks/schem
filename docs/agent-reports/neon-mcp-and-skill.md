# Agent report: MCP 11-tool expansion and shipped agent skill

- Branch: `t3/8977254b` (isolated T3 worktree branch, not `main`)
- Worktree path: `C:/Users/ntlak/.t3/worktrees/Schematic circuit/t3-8977254b-b9b4699cc529dd34`
- Commits:
  - `8fe79b9` Expose all 11 MCP tools and implement schem_component
  - `8ba808f` Add CLI component command and list all 11 MCP tools in bin help
  - `5ecc8fe` Add shipped schem agent skill, package files and install docs
  - `f340999` Update MCP contract test for 11 tools and add unit and stdio coverage
  - (plus the commit adding this report)

## Summary of changes

1. **`src/mcp/commands.ts` and `src/mcp/tools.ts`**:
   - Implemented `schem_component` in `src/mcp/commands.ts`. It accepts `{ type: string }`, looks up built-in symbols (`BUILTIN`), shipped modules (`MODULE_LIBRARY`), `ic` and `header`, and returns the full pin inventory (numbers, names, aliases, roles, groups, interfaces, chain direction, representative flags), `refPrefix`, and module `doc` metadata (`groups`, `interfaces`, `representatives` when present). For unknown types it returns a clear error with close matches (`suggestions`) found by substring, edit-distance and token matching.
   - Validated `table` in `schemDescribe` as an optional boolean flag.
   - Exposed all 11 tools in `TOOLS` in `src/mcp/tools.ts` (`schem_create`, `schem_edit`, `schem_check`, `schem_preview`, `schem_query`, `schem_render`, `schem_undo`, `schem_describe`, `schem_fmt`, `schem_components`, `schem_component`), documented `finding` on `schem_preview`, noted `.schem` text DSL preference in `schem_create`, and removed the `LATER` rejection gate.
2. **`src/mcp/server.ts`**:
   - Updated `INSTRUCTIONS` and `HELP` to describe all 11 tools, explicitly note that `.schem` text DSL is supported and preferred for brevity in `schem_create`, and document the recommended workflow loop (`schem_components`/`schem_component` -> `schem_create` -> `schem_check` -> `schem_edit` -> `schem_preview` -> `schem_render`, plus `schem_undo`, `schem_query`, `schem_describe` and `schem_fmt`).
3. **`skills/schem/SKILL.md` (new, 95 lines)**:
   - Added the shipped agent skill under 150 lines in plain English for Claude Code, Cursor and Codex users.
   - Covers core rules, the 11-tool MCP workflow, check-edit-preview-render stopping rules, the rule never to alter the circuit just to improve the drawing, the CLI workflow, and a `.schem` syntax cheat sheet.
4. **`package.json`**:
   - Added `docs/dsl.md`, `docs/templates.md`, and `skills/schem/SKILL.md` to the `files` array. Dependencies were not changed.
5. **`docs/install.md`**:
   - Updated the MCP tool list to all 11 tools, documented `.schem` text DSL support, updated the shipped package contents list, and added an "Agent skill" section explaining where `skills/schem/SKILL.md` lives and how to install it for Claude Code, Cursor and Codex CLI.
6. **`src/cli.ts` and `src/bin.ts`**:
   - Added `component <type>` to the CLI shared verbs and plain-text output formatter while keeping the existing `USAGE` line `npm run schem -- draw examples/led.schem.json` intact.
   - Updated `src/bin.ts` `MCP_LINE` so `schem --help` accurately lists all 11 MCP tools.
7. **`tests/mcp.test.ts` and `tests/dsl-cli.test.ts`**:
   - Updated the `tools/list` contract test in `tests/mcp.test.ts` to assert all 11 tools and updated the unknown-tool check without weakening any other existing assertion.
   - Added unit tests for `schem_components`, `schem_component`, `schem_undo`, `schem_describe`, and `schem_fmt` (including error cases, close-match suggestions, lossy JSON conversion rejection, idempotency and root/junction confinement).
   - Added a full stdio test covering `initialize`, `tools/list` (11 tools), `schem_components`, `schem_component`, `schem_create` (with `.schem` DSL), `schem_describe`, `schem_edit`, `schem_undo`, and `schem_fmt`.
   - Added CLI assertions for `component` in `tests/dsl-cli.test.ts`.

## Files changed

- `src/mcp/commands.ts`
- `src/mcp/tools.ts`
- `src/mcp/server.ts`
- `src/cli.ts`
- `src/bin.ts`
- `skills/schem/SKILL.md` (new)
- `package.json`
- `docs/install.md`
- `tests/mcp.test.ts`
- `tests/dsl-cli.test.ts`
- `docs/agent-reports/neon-mcp-and-skill.md` (new)

## Verification

### `npm run typecheck`

```text
> schem-cli@0.0.1 typecheck
> tsc --noEmit && tsc --noEmit -p web
```

Exit code: `0`.

### `npm test`

```text
> schem-cli@0.0.1 test
> vitest run

 Test Files  32 passed (32)
      Tests  673 passed (673)
   Duration  21.97s
```

Exit code: `0`.

### `npm run phase0`

```text
> schem-cli@0.0.1 phase0
> tsx scripts/phase0.ts

case                           status                             verifier  overlaps conv read ms
case01-led                     valid                              valid     0        0    0    273
case02-divider-buffer          valid                              valid     0        0    0    121
case03-summing                 valid                              valid     0        0    0    47
case04-hbridge                 valid                              valid     0        0    0    484
case05-i2c                     valid                              valid     0        0    0    36
case06-esp32-relay             valid                              valid     0        0    0    52
case07-two-ic-decoupling       valid                              valid     0        0    0    67
case08-diffpair                valid                              valid     0        0    0    30
```

All 8 validation cases are `valid` with 0 overlaps, 0 convention findings, and 0 readability findings; all validation edit scripts match expected status and pass gate 4. Exit code: `0`.

### `npm run build`

```text
> schem-cli@0.0.1 build
> tsx scripts/build.ts

wrote dist/schem.js (494 KB) and dist/fonts/; external: @resvg/resvg-js, opentype.js
```

Exit code: `0`.

### `npm run pack:smoke`

```text
> schem-cli@0.0.1 pack:smoke
> tsx scripts/pack-smoke.ts

  ok 1  npm pack: schem-cli-0.0.1.tgz, 533.6 kB packed, 1327.0 kB unpacked, 23 files
  ...
  ok 5  installed: mcp initialize: serverInfo schem 0.0.1, same instructions as the repo
  ok 6  installed: mcp tools/list: schem_create, schem_edit, schem_check, schem_preview, schem_query, schem_render, schem_undo, schem_describe, schem_fmt, schem_components, schem_component, identical to the repo
  ok 7  installed: mcp schem_create (status valid, same revision and layoutToken) then schem_render: SVG byte-identical to the repo's server
  ...
  ok 12 npx: mcp tools/list: schem_create, schem_edit, schem_check, schem_preview, schem_query, schem_render, schem_undo, schem_describe, schem_fmt, schem_components, schem_component, identical to the repo
  ...
  ok 15 clone install (npm install -g .): draw led, esp32-relay, summing-amp: SVG and PNG byte-identical to the repo's
pack:smoke passed: schem-cli-0.0.1.tgz, 533.6 kB, 23 files
```

Tarball file list confirmed inclusion of `docs/dsl.md`, `docs/templates.md`, and `skills/schem/SKILL.md`. Exit code: `0`.

## Skipped or not applicable

- `npm run bench -- --check` was not needed because `src/layout/` was not touched.
- No PNG drawings were added or altered in the repository, so no PNG visual inspection was required.

## Open questions

None.
