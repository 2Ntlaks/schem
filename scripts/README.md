# Scripts

Helper scripts for building, testing, benchmarking, and generating documentation assets. All scripts are TypeScript files run with `tsx` (a TypeScript runner for Node.js).

> **Test-set hygiene:** Never pass `--test` to `scripts/phase0.ts` or `scripts/gates.ts` (`npm run phase0 -- --test` or `npm run gates -- --test`). That flag reads the held-out test set reserved for the final evaluation. See [`../AGENTS.md`](../AGENTS.md) and [`../CONTRIBUTING.md`](../CONTRIBUTING.md).

## Top-level scripts (`scripts/*.ts`)

| Script | Command | Purpose |
|---|---|---|
| [`appendix-a.ts`](appendix-a.ts) | `npx tsx scripts/appendix-a.ts` | Draws the Appendix A worked examples from `tests/support/appendix-a.ts` to `out/appendix-a1.png` and `out/appendix-a2.png` for visual review. |
| [`bench.ts`](bench.ts) | `npm run bench` | Draws all 18 circuits in [`../bench/circuits/`](../bench/circuits/), scores them against [`../bench/baseline.json`](../bench/baseline.json), and writes images plus `out/bench/index.html`. Supports `--check` and `--update`. |
| [`bench-debug.ts`](bench-debug.ts) | `npx tsx scripts/bench-debug.ts <name>` | Prints part placements, columns, rotations, blocks, and layout notes for one benchmark circuit. |
| [`bench-sheet.ts`](bench-sheet.ts) | `npx tsx scripts/bench-sheet.ts [names...]` | Combines PNGs in `out/bench/` into a single contact sheet at `out/bench/sheet.png` (run `npm run bench` first). |
| [`build.ts`](build.ts) | `npm run build` | Bundles `src/bin.ts` (CLI and MCP server) into `dist/schem.js` with esbuild and copies DejaVu Sans and its licence into `dist/fonts/`. Also runs via `prepack`. |
| [`draw.ts`](draw.ts) | `npm run draw` | Lays out, verifies, and renders every JSON circuit in [`../cases/`](../cases/) (or any files passed on the command line) to `out/<name>.svg` and `.png`. Used by CI to verify Windows and Linux output are byte-identical. |
| [`edit-sweep.ts`](edit-sweep.ts) | `npx tsx scripts/edit-sweep.ts` | Runs the random-edit stability sweep from `tests/edits.test.ts` and prints which generated edits break the stability gate. |
| [`findings-snapshot.ts`](findings-snapshot.ts) | `npx tsx scripts/findings-snapshot.ts` | Rewrites `tests/snapshots/findings.json`. Run only when layout or check findings change on purpose. |
| [`gallery.ts`](gallery.ts) | `npm run readme:gallery` | Renders the README gallery PNGs (`docs/assets/gallery-*.png`) directly from circuits in [`../examples/`](../examples/). |
| [`gates.ts`](gates.ts) | `npm run gates` | Runs the Phase 0b gate harness (SPEC section 15, gates 1 to 6) on the validation set and prepares the blind rating pack. Never pass `--test` during development. |
| [`pack-smoke.ts`](pack-smoke.ts) | `npm run pack:smoke` | Packs the npm tarball, installs it into a clean temporary folder, and checks that the packaged `schem` CLI, `schem mcp` server, `npx`, and global install match the repo source byte for byte. |
| [`parts-doc.ts`](parts-doc.ts) | `npm run docs:parts` | Generates [`../docs/parts.md`](../docs/parts.md) from `BUILTIN` symbols and `MODULE_LIBRARY` boards. |
| [`phase0.ts`](phase0.ts) | `npm run phase0` | Runs the 8 Phase 0b validation cases and edit scripts for cases 3, 5, and 7, writing SVGs, PNGs, and JSON summaries to `out/phase0/`. Never pass `--test` during development. |
| [`readme-art.ts`](readme-art.ts) | `npm run readme:art` | Generates the README hero image (`docs/assets/hero.png`) from [`../examples/summing-amp.schem.json`](../examples/summing-amp.schem.json). |
| [`showcase.ts`](showcase.ts) | `npm run showcase` | Rebuilds the cross-tool comparison images and HTML page in [`../docs/showcase/`](../docs/showcase/). |
| [`symbols.ts`](symbols.ts) | `npm run draw:symbols` | Renders small test circuits for built-in symbols and a pin-numbered contact sheet at `out/symbols/sheet.png`. |
| [`templates.ts`](templates.ts) | `npx tsx scripts/templates.ts` | Renders every template circuit from `tests/support/template-circuits.ts` into `out/templates/` and prints block graphs and metrics. |

## Shared helpers (`scripts/lib/*.ts`)

| Module | Purpose |
|---|---|
| [`lib/bench-score.ts`](lib/bench-score.ts) | Computes the numeric score (lower is better) for a benchmark drawing from crossings, bends, wire length, convention warnings, readability breaches, and flow checks. |
| [`lib/case-run.ts`](lib/case-run.ts) | Shared runner for frozen Phase 0b cases and edit scripts, imported by `phase0.ts` and `gates.ts`. |
| [`lib/gate-math.ts`](lib/gate-math.ts) | Pure "at least k of n" gate verdict logic (`pass`, `fail`, `incomplete`) for SPEC section 15, tested in `tests/gates.test.ts`. |
| [`lib/phase0-gates.ts`](lib/phase0-gates.ts) | Evaluates machine-checkable Phase 0b gate evidence and builds the `out/phase0/gates.json` summary. |
