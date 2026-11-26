# Agent report: `neon/cleanup-docs`

## What I did

Audited, updated and aligned all guides in `docs/` and `skills/schem/SKILL.md` on branch `neon/cleanup-docs` against the current CLI (command-line interface) and 12-tool MCP (Model Context Protocol) implementation in `src/cli.ts`, `src/cli-templates.ts`, `src/io/spice.ts`, `src/io/edit-script.ts`, `src/render/themes.ts`, `src/layout/templates/library.ts`, `src/mcp/tools.ts` and `src/symbols/library.ts`.

Summary of updates:

- **`docs/README.md`**: Reorganised into **Getting started**, **Reference guides**, **Architecture & benchmarks** and **Project history**. Updated the examples count from eight circuits to 12 examples (8 JSON and 4 `.schem` text files). Added links to `install.md`, `themes.md`, `spice-import.md` and `../skills/schem/SKILL.md`.
- **`docs/dsl.md`**: Updated the CLI command reference table to include all 14 commands and current flags from `src/cli.ts`: `init [name] [--template <name>]` (listing all 6 starter templates: `led`, `divider`, `opamp`, `regulator`, `i2c`, `bjt-amp`), `component <type>`, `import <file.cir> [-o <output.schem>] [--overwrite]`, `watch <file> [-o <dir>] [--theme <name>] [--transparent]`, `describe <file> [--table] [--alt-text]`, and `--theme <name>` / `--transparent` on `render` and `draw`. Added links to `themes.md`, `spice-import.md` and `install.md`, and noted MCP `schem_import` alongside `schem_create`.
- **`docs/themes.md`**: Moved **CLI and MCP usage** (`schem render`, `schem draw`, `schem watch` with `--theme` and `--transparent`, and MCP `schem_render`) ahead of file-level theme config (`.schem` `style theme=...` and `.schem.json` `intent.style.theme`) and moved the programmatic TypeScript API to an advanced section at the bottom.
- **`docs/spice-import.md`**: Moved **CLI and MCP usage** (`schem import` and MCP `schem_import`) to the top and moved the programmatic TypeScript API (`importSpice()`) to an advanced section at the bottom. Updated the `I<id> pos neg <val>` row to reflect that `current-source` is shipped in `BUILTIN` (`src/symbols/library.ts`) and maps `pos` to `-` and `neg` to `+` so the symbol arrow matches SPICE (Simulation Program with Integrated Circuit Emphasis) current direction.
- **`docs/editing.md`**: Verified random-edit stability with `npx tsx scripts/edit-sweep.ts` and updated the stale `133` figure to `134` of 137 random test edits (97.8%). Clarified that `schem edit` (and MCP `schem_edit`) supports both `.schem` text files (storing the cached drawing in a trailing `# schem-layout:` comment) and `.schem.json` files (storing a `layout` section), added `schem undo` / `schem_undo`, and aligned exit codes with `src/cli.ts`.
- **`docs/general-layout.md`**: Updated line 45 from ``Current `neon/usability-sprint` `` to `Current main (2026-11-26)` and verified the benchmark score (`886.9` across 18 circuits from `bench/baseline.json`) and edit stability (`134 of 137 (97.8%)`).
- **`docs/install.md`**: Added concise mentions of `schem init [name] --template <name>` (all 6 starter templates) and `schem watch <file> [-o <dir>]`, and verified CLI and MCP (`dist/schem.js`) instructions match `src/cli.ts` and `scripts/build.ts`.
- **`docs/templates.md`**: Verified every template against `src/layout/templates/library.ts`. Updated `npn-led-astable` (version 2) to describe the current layout accurately (both timing capacitors on one row above the collectors, connecting to each side's bias resistor column, with the two base wires crossing once in the centre below). Updated `opamp-inverting` (optional difference-amp resistors on `IN+`), `low-side-*-two-pin` (includes `inductor`), `voltage-divider` (staggered lower resistor for 4+ endpoints on the tap) and the priority summary.
- **`docs/netlist-format.md`**: Added cross-links to `dsl.md`, `spice-import.md`, `parts.md`, `themes.md`, `../SPEC.md` and `../examples/led.schem.json`.
- **`docs/parts.md`**: Ran `npm run docs:parts` (41 part types); the generated file matched `src/symbols/library.ts` and `src/modules/*.json` with no diff.
- **`skills/schem/SKILL.md`**: Added all missing shipped `BUILTIN` symbols (`current-source`, `photodiode`, `spdt`, `speaker`, `lamp`) so all 31 built-in symbols plus `ic`, `header` and `module:*` are listed. Removed unimplemented `setNetStyle` (listed in `NOT_YET` in `src/io/edit-script.ts`) from the visual edit ops list and listed supported ops instead. Kept the file at 98 lines (under the 150-line cap).

## Files changed

- `docs/README.md`
- `docs/dsl.md`
- `docs/themes.md`
- `docs/spice-import.md`
- `docs/editing.md`
- `docs/general-layout.md`
- `docs/install.md`
- `docs/templates.md`
- `docs/netlist-format.md`
- `skills/schem/SKILL.md`
- `docs/agent-reports/neon-cleanup-docs.md`

No files outside the strict ownership list were modified. `docs/parts.md` was regenerated with `npm run docs:parts` and produced no diff.

## Commands run and results

- `npm ci`: passed (exit 0; installed existing locked dependencies in the fresh worktree without modifying `package.json` or `package-lock.json`).
- `npx tsx scripts/edit-sweep.ts`: passed (exit 0; `134 of 137 saved edits are stable (97.8%)`; three `longer value` edits `#28`, `#50`, `#76` exceeded limits).
- `npm run docs:parts`: passed (exit 0; `wrote docs/parts.md (41 part types)`, no git diff).
- Dash and relative-link audit script across all `docs/*.md` (14 files) and `skills/schem/SKILL.md` (1 file): passed (exit 0; 0 em/en dashes, 0 broken relative links, `skills/schem/SKILL.md` 99 lines including trailing newline).
- `BUILTIN` symbol coverage check against `skills/schem/SKILL.md`: passed (exit 0; `BUILTIN: 31 missing: []`).
- `npm run typecheck`: passed (exit 0; `tsc --noEmit` reported no errors).
- `npm test`: passed (exit 0; 39 test files passed, 778 tests passed).
- `npm run phase0`: passed (exit 0; all 8 validation cases `valid` with 0 overlaps; 11 saved edits passed gate 4 and 1 expected rejection `case03-pin-sides`).
- `npm run build`: passed (exit 0; `wrote dist/schem.js (595 KB) and dist/fonts/; external: @resvg/resvg-js, opentype.js`).
- `npm run pack:smoke`: passed (exit 0; all 15 smoke checks passed, `schem-cli-0.0.2.tgz`, 563.6 kB, 28 files).

## Skipped or could not do

- Did not touch `src/`, `tests/`, `README.md`, `CONTRIBUTING.md`, `examples/README.md`, `package.json`, `package-lock.json`, `SPEC.md`, `phase0/` or `baselines/`, per strict file ownership and `AGENTS.md` rules.
- Did not run `npm run bench -- --check` because `src/layout/` was not modified.
- No images were produced or modified, so visual PNG inspection did not apply.

## Open questions

None.
