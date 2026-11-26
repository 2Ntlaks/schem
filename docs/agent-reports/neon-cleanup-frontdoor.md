# Front door, gallery, contributor guide, and GitHub templates (`neon/cleanup-frontdoor`)

## What was done

1. **Upgraded the README gallery (`scripts/gallery.ts` and `docs/assets/`):**
   - Updated `scripts/gallery.ts` to load both `.schem` text schematics and `.schem.json` files (using `formatOf` and `projectText`), and to pass optional rendering themes to `toSvg` and `toPng`.
   - Added two engine-generated gallery PNGs to `docs/assets/`:
     - `docs/assets/gallery-pico-i2c-oled.png` from `examples/pico-i2c-oled.schem` (Raspberry Pi Pico driving an SSD1306 OLED over I2C with pull-ups and a status LED).
     - `docs/assets/gallery-summing-dark.png` from `examples/summing-amp.schem.json` rendered with `theme: "dark"`.
   - Ran `npm run readme:gallery` and opened all five generated PNGs in `docs/assets/` to inspect them visually. All five are clean, crisp, and legible with no overlapping labels, no white fringe on the dark theme, and byte-identical output for the three existing gallery PNGs.

2. **Polished `README.md`:**
   - Kept the hero section, value proposition, and honest prototype tone.
   - Updated **Quick start** to showcase `.schem` text DSL workflows (`init --template`, `draw`, `watch`, `import`, `describe --alt-text`, `--theme`) alongside JSON examples.
   - Added a **CLI and MCP command summary** table covering all 15 CLI commands (`init`, `draw`, `watch`, `render`, `check`, `preview`, `edit`, `undo`, `query`, `describe`, `components`, `component`, `fmt`, `import`, `mcp`) and listing all 12 MCP tools with links to `docs/dsl.md` and `docs/install.md`.
   - Updated **Gallery** to feature `gallery-pico-i2c-oled.png` and `gallery-summing-dark.png` alongside the existing showcase and filter/oscillator drawings.
   - Updated **Write your own** to show the short `.schem` text schematic first (matching `examples/led.schem`), with the JSON equivalent (`examples/led.schem.json`) in a collapsible `<details>` block.
   - Added a **Repository layout** table before **Contributing** explaining every top-level directory (`src/`, `docs/`, `examples/`, `skills/schem/`, `bench/`, `cases/`, `scripts/`, `tests/`, `phase0/`, `baselines/`, `archive/`).
   - Verified all numbers and links (`31` built-in symbols, `10` modules, `12` examples = `8` JSON + `4` `.schem`, `12` MCP tools, `134 of 137` edit stability, `18 of 18` bench circuits drawing valid with total score `886.9`).

3. **Fixed and expanded `examples/README.md`:**
   - Updated the opening line from "Eight circuit files" to twelve examples (4 `.schem` text schematics and 8 JSON netlists).
   - Fixed the bare `docs/netlist-format.md` reference to a relative link (`../docs/netlist-format.md`) and linked every example file in both tables.
   - Documented `schem init circuit.schem --template <name>` (`led`, `divider`, `opamp`, `regulator`, `i2c`, `bjt-amp`), `--theme`, `--transparent`, and `watch`.
   - Ran `npx tsx src/cli.ts check` on all 12 example files in `examples/`; every file passed `valid` with exit code 0.

4. **Polished `CONTRIBUTING.md`:**
   - Standardised spelling to `License` / `license` throughout.
   - Aligned setup and verification steps with the CLI and MCP workflow, adding `npm run bench -- --check` (when touching `src/layout/`) and `npm run build` plus `npm run pack:smoke` (when touching CLI, MCP, or packaging).
   - Linked to the new `.github/ISSUE_TEMPLATE/` forms and `.github/PULL_REQUEST_TEMPLATE.md`, and noted that `.schem` example circuits are welcome alongside `.schem.json`.

5. **Added GitHub issue and pull request templates:**
   - `.github/ISSUE_TEMPLATE/bad-drawing.md`
   - `.github/ISSUE_TEMPLATE/new-symbol-or-board.md`
   - `.github/ISSUE_TEMPLATE/bug-report.md`
   - `.github/PULL_REQUEST_TEMPLATE.md`

## Files changed

- `README.md`
- `CONTRIBUTING.md`
- `examples/README.md`
- `scripts/gallery.ts`
- `docs/assets/gallery-pico-i2c-oled.png` (new)
- `docs/assets/gallery-summing-dark.png` (new)
- `.github/ISSUE_TEMPLATE/bad-drawing.md` (new)
- `.github/ISSUE_TEMPLATE/new-symbol-or-board.md` (new)
- `.github/ISSUE_TEMPLATE/bug-report.md` (new)
- `.github/PULL_REQUEST_TEMPLATE.md` (new)
- `docs/agent-reports/neon-cleanup-frontdoor.md` (new)

No files outside the allowed ownership list were modified (`src/`, `docs/*.md`, `skills/`, `package.json`, `package-lock.json`, `tests/`, `SPEC.md`, `phase0/`, and `baselines/` were left untouched).

## Commands run and results

- `npm ci` (restored `node_modules` in the fresh worktree without touching `package.json` or `package-lock.json`): passed (exit 0).
- `npx tsx src/cli.ts check` on all 12 files in `examples/`: all 12 printed `valid` (exit 0).
- Dash and local relative-link check across all modified/created Markdown files and `scripts/gallery.ts`: passed (`0` em/en dashes, `0` broken links across `99` local links).
- `npm run readme:gallery`: passed (exit 0); wrote all 5 gallery PNGs (`gallery-sallen-key-filter.png` 35 KB, `gallery-wien-bridge.png` 27 KB, `gallery-relaxation-oscillator.png` 22 KB, `gallery-pico-i2c-oled.png` 43 KB, `gallery-summing-dark.png` 34 KB). All 5 PNGs were inspected visually.
- `npm run typecheck`: passed (`tsc --noEmit`, exit 0).
- `npm test`: passed (39 test files passed, 778 tests passed, exit 0).
- `npm run phase0`: passed (all 8 validation cases `valid`, 0 overlaps, 0 convention issues, 0 readability issues; exit 0). Removed temporary `out/` afterward.

## Skipped or could not do

- `npm run bench -- --check` was not run because `src/layout/` was not modified.
- Held-out test set commands (`npm run gates -- --test`, `npm run phase0 -- --test`) were not run, per `AGENTS.md`.

## Open questions

None.
