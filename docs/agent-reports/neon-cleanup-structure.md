# Agent report: `neon/cleanup-structure`

## What was done

1. **Packaging metadata and ignore rules (`package.json`, `package-lock.json`, `.gitignore`):**
   - Verified with `git grep` that no source file, script, or test imported the `marked` package.
   - Removed the unused `marked` devDependency with `npm uninstall marked` (updating only `package.json` and `package-lock.json`) and verified `npm ci` runs cleanly afterward.
   - Updated `"description"` in `package.json` to cover `.schem` text DSL, JSON netlists, and SPICE import: `"Turn a circuit description (.schem text, JSON, or SPICE) into a clean, verified schematic drawing (SVG and PNG). A CLI and an MCP server for AI agents."`
   - Added standard OS and npm log ignore patterns (`.DS_Store`, `Thumbs.db`, `npm-debug.log*`) to `.gitignore`, and confirmed with `git ls-files -c -i --exclude-standard` that no tracked files are ignored.

2. **Folder guide `README.md` files:**
   - Added `scripts/README.md` listing every script in `scripts/*.ts` and `scripts/lib/*.ts`, its matching `npm run` command where one exists, and a warning never to pass `--test` to `scripts/phase0.ts` or `scripts/gates.ts`.
   - Added `bench/README.md` explaining the 18 benchmark circuits in `bench/circuits/`, `bench/baseline.json`, the benchmark commands (`npm run bench`, `--check`, `--update`, `bench-sheet.ts`, `bench-debug.ts`), and linking to `docs/general-layout.md`.
   - Added `cases/README.md` explaining the 3 Phase 0a development circuits (`case01-led.json`, `case03-summing.json`, `case05-i2c.json`), their role in `npm run draw`, CI Windows/Linux determinism hashing, and tests, and pointing readers to `examples/` for starter circuits.
   - Added `archive/README.md` explaining the pre-1.0 specification drafts (`SPEC-revA.md` through `SPEC-revC2.md`), their reviews, and `schematic-plan.html`, kept for historical context referenced by `SPEC.md`.
   - Added `docs/agent-reports/README.md` explaining the historical agent task reports and comparison PNGs, and pointing readers to `docs/README.md` and the root `README.md` for current documentation.

3. **Automated repository hygiene tests (`tests/repo-hygiene.test.ts`):**
   - Added a Vitest (the project's test runner) test file with 6 deterministic checks that pass on current `main` without asserting brittle heading or prose text:
     1. Every local Markdown link `[text](path)` and HTML `<img src="path">` in `README.md`, `CONTRIBUTING.md`, `examples/README.md`, `skills/schem/SKILL.md`, all root-level `docs/*.md`, and the 5 new folder READMEs resolves to an existing file or directory on disk.
     2. Zero em dashes (`\u2014`) or en dashes (`\u2013`) appear in user-facing documentation (`README.md`, `CONTRIBUTING.md`, `examples/README.md`, `skills/schem/SKILL.md`, current user guides in `docs/*.md` excluding the 4 historical Phase 0a/0b notes and audit files, and the 5 new folder READMEs).
     3. `docs/parts.md` lists every symbol id from `BUILTIN` (`src/symbols/library.ts`) and every board module id from `src/modules/*.json`.
     4. `examples/README.md` mentions every `.schem` and `.schem.json` file in `examples/`.
     5. `skills/schem/SKILL.md` stays at or under 150 lines and mentions all 12 MCP (Model Context Protocol) tools (`schem_create`, `schem_edit`, `schem_check`, `schem_preview`, `schem_query`, `schem_render`, `schem_undo`, `schem_describe`, `schem_fmt`, `schem_components`, `schem_component`, `schem_import`).
     6. `package.json` and `.github/workflows/*.yml` contain no `web:build`, `web:serve`, or `web/` references, and `marked` is absent from `package.json`.

## Files changed

- Modified: `package.json`, `package-lock.json`, `.gitignore`
- Created: `scripts/README.md`, `bench/README.md`, `cases/README.md`, `archive/README.md`, `docs/agent-reports/README.md`, `tests/repo-hygiene.test.ts`, `docs/agent-reports/neon-cleanup-structure.md`

No other files were created or modified. Held-out test paths (`phase0/cases/test/`, `phase0/cases/edits/case11-*`, `baselines/LOG-test.md`, `baselines/out/*/test/`, `baselines/out/_netlist/test/`) were never opened, listed, read, or run.

## Commands run and results

| Command | Result |
|---|---|
| `npm uninstall marked` | Passed (exit 0). Removed `marked@12.0.2` from `package.json` and `package-lock.json`. |
| `npm ci` | Passed (exit 0). Installed 63 packages cleanly after lockfile update. |
| `git ls-files -c -i --exclude-standard` | Passed (exit 0). No output; no tracked files matched `.gitignore`. |
| `npm run typecheck` | Passed (exit 0). `tsc --noEmit` reported 0 errors. |
| `npm test` | Passed (exit 0). 40 test files passed (40), 784 tests passed (784), including all 6 new tests in `tests/repo-hygiene.test.ts`. |
| `npm run phase0` | Passed (exit 0). All 8 validation cases (`case01-led` through `case08-diffpair`) drew `valid` with 0 overlaps; all validation edit scripts behaved as expected (11 saved and passed gate 4, 1 expected rejection `case03-pin-sides`). |
| `npm run build` | Passed (exit 0). Wrote `dist/schem.js` (595 KB) and `dist/fonts/`. |
| `npm run pack:smoke` | Passed (exit 0). All 15 checks passed: `schem-cli-0.0.2.tgz`, 562.2 kB packed, 28 files, byte-identical CLI/MCP/npx/global-install output. |

## Skipped or not applicable

- `npm run bench -- --check` was not run because `src/layout/` was not touched.
- No drawings were modified or added, so no new PNG visual inspection was required.
- Held-out test commands (`npm run gates -- --test`, `npm run phase0 -- --test`) were not run, per `AGENTS.md`.

## Open questions

None.
