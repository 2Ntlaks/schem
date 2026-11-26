# Report: neon/usability-sprint

Branch `neon/usability-sprint`, branched from `main` at `1e235fc` (`git merge --ff-only neon/usability-sprint` lands cleanly onto `main`). Nothing was pushed, merged, or rebased on `main`.

## Summary

Eight `gemini-4-neon` agents ran in parallel across both Antigravity accounts (`antigravity` and `antigravity2`) in isolated worktrees with disjoint file ownership. All eight branches merged onto `neon/usability-sprint` with zero conflicts, followed by cross-branch integration glue, regenerated docs, and an updated benchmark baseline (`908.1 -> 886.9`).

## Integrated workstreams

1. **Render themes and transparent export (`t3/e77f0e9f`):**
   - Added `clean`, `dark`, `blueprint`, `textbook`, and `mono-print` themes in `src/render/themes.ts`, optional `meta.theme` in `src/render/model.ts`, `SvgOptions` (`theme`, `transparent`) in `src/render/svg.ts`, `PngOptions` (`transparent`, `background`) in `src/render/png.ts`, `docs/themes.md`, and 12 tests in `tests/themes.test.ts`.
   - Default `clean` SVG and PNG output stays byte-for-byte identical to `main`.
2. **Phase 1 symbols (`t3/84709191`):**
   - Added 5 original IEEE-style symbols (`current-source`, `lamp`, `speaker`, `photodiode`, `spdt`) in `src/symbols/library.ts` (31 built-in symbols total), `switch` default orientation in `src/layout/kinds.ts`, 5 symbol circuits in `tests/support/symbol-circuits.ts`, and convention checks in `tests/symbols.test.ts`.
3. **Verified dev boards and `.schem` examples (`t3/2caf47c5`):**
   - Added 6 datasheet-verified modules (`raspberry-pi-pico`, `arduino-nano`, `esp32-s3-devkitc-1`, `adafruit-bme280`, `ssd1306-oled-i2c`, `lm7805`) under `src/modules/` (10 boards total), 3 `.schem` examples (`examples/pico-i2c-oled.schem`, `examples/lm7805-supply.schem`, `examples/nano-bme280.schem`), and 17 tests in `tests/modules-extra.test.ts`.
4. **SPICE netlist importer (`t3/4f76aa52`):**
   - Added `importSpice()` in `src/io/spice.ts` supporting resistors, capacitors, inductors, diodes (including Zener, Schottky, LED), voltage/AC/current sources, NPN/PNP BJTs, NMOS/PMOS MOSFETs, `.model` / `.subckt` resolution, and `.schem` output via `formatDsl()`. Added `docs/spice-import.md` and 20 tests in `tests/spice-import.test.ts`.
5. **Reader-facing alt text, net table, and Gate 6 speed-up (`t3/6d0a6354`):**
   - Added verified `altText`, `netTable`, and `netTableMarkdown` in `src/quality/alt-text.ts` (7 tests in `tests/alt-text.test.ts`).
   - Optimized `review()` in `src/edit/findings.ts` by caching dry-runs, deduplicating candidates, skipping `circuitEquals` on pure visual ops, and pruning provable no-ops while keeping all findings snapshots byte-identical. Gate 6 warm p95 on `generated #30 (16 patterns)` dropped to `801 ms` (limit `3000 ms`).
6. **Layout polish (`neon/layout-polish`):**
   - Ported `claude/supply-string` (`src/layout/stacks.ts`, `src/layout/flow.ts`, `tests/supply-string.test.ts`): `sensor-node` improved `92.1 -> 77.8`.
   - Sorted top-edge box pins so `power_in` precedes `power_out` in `src/layout/layout.ts` (`U1` and `U2` in `sensor-node`).
   - Updated `npn-led-astable` (`version: 2`) in `src/layout/templates/library.ts`: `multivibrator` improved `63.3 -> 58.3` (`cross: 2 -> 1`).
   - Preserved previous channel gaps in `keptGap` when existing outlines still clear: random-edit stability rose from `131/137` (`95.6%`) to `134/137` (`97.8%`).
   - Evaluated PR #5 (`rc-rl-filter`) and left it out because it regressed `ne555` (`41.3 -> 41.9`) and dropped random-edit stability to `130/137` (`94.89%`).
7. **Full 11-tool MCP server, CLI polish, and agent skill (`t3/8977254b`):**
   - Exposed `schem_components`, `schem_component`, `schem_undo`, `schem_describe`, and `schem_fmt` alongside the existing 6 MCP tools in `src/mcp/tools.ts`, `src/mcp/commands.ts`, and `src/mcp/server.ts`.
   - Added `schem component <type>` to `src/cli.ts`, shipped `skills/schem/SKILL.md` (95 lines), and updated `package.json` `files` and `docs/install.md`.
8. **Playground `.schem` text DSL and live docs (`t3/a2cf549b`):**
   - Added `.schem` parsing, syntax highlighting, `Tidy`, `To .schem` / `To JSON` conversion, `.schem` Parts insertion, `.schem` downloads/share links, and `.schem` examples in `web/` and `scripts/lib/web-bundle.ts`.
   - Expanded `docs.html` in `scripts/lib/docs-page.ts` to render `docs/dsl.md`, `docs/templates.md`, and `docs/install.md` with "Open in the playground" buttons for valid `.schem` blocks.

## Integration glue added on `neon/usability-sprint`

- `8a1ce69` - **Current-source quantity and SPICE direction:** Added `current-source` to `quantityOf` in `src/core/quantity.ts` (`"10m"` formats as `10 mA`) and aligned `Ixxx n+ n- val` in `src/io/spice.ts` so `n-` connects to `I[+]` and `n+` connects to `I[-]` in `tests/spice-import.test.ts`.
- `18ad3f0` - **End-to-end wiring:**
  - Propagated `project.intent?.style?.theme` onto `RenderModel["meta"].theme` in `src/layout/layout.ts`.
  - Re-exported `altText`, `netTable`, `netTableMarkdown`, and `NetTableRow` from `src/quality/index.ts`.
  - Added `--theme` and `--transparent` support to `schem_render` (`src/mcp/commands.ts`, `src/mcp/tools.ts`, `src/mcp/sheet.ts`) and CLI `render` and `draw` (`src/cli.ts`).
  - Added `altText` to `schem_describe` (`src/mcp/commands.ts`) and CLI `describe` (`src/cli.ts`).
  - Added `schem import <file.cir> [-o <output.schem>] [--overwrite] [--json]` to `src/cli.ts`.
  - Updated `tests/mcp.test.ts` (`query: "arduino"` now expects `["module:arduino-nano", "module:arduino-uno-r3"]`) and added `tests/integration-sprint.test.ts` (6 tests).
- `73cf328` - **Generated docs and baseline:**
  - Regenerated `docs/parts.md` (41 part types: 31 symbols, 10 boards).
  - Updated `bench/baseline.json` from `908.1` to `886.9`.
  - Added `docs/themes.md` and `docs/spice-import.md` to `package.json` `files`.
  - Refreshed `docs/general-layout.md` and `README.md`.

## Visual checks

- Inspected themed sample PNGs (`summing-amp-dark.png`, `summing-amp-blueprint.png`, `summing-amp-textbook.png`), new symbol sheets (`sheet.png`, `current-source-load.png`, `spdt-selector.png`, `photodiode-sensor.png`), SPICE renders (`ce-amplifier.png`, `cmos-inverter.png`, `rc-lowpass.png`), new board examples (`pico-i2c-oled.png`, `lm7805-supply.png`, `nano-bme280.png`), bench diffs (`sensor-node-after.png`, `multivibrator-after.png`), and the final CLI dark-theme render `out/verify-lm7805-dark.png` (`lm7805-supply.schem --theme dark`). All render crisply with zero overlaps.

## Verification outputs (after final code/docs commits)

- `npm run typecheck`: exit `0` (`tsc --noEmit && tsc --noEmit -p web`).
- `npm test`: exit `0`, `Test Files 39 passed (39)`, `Tests 780 passed (780)` (19.61s).
- `npm run phase0`: exit `0`, all 8 validation cases (`case01-led` through `case08-diffpair`) `valid` with `0` overlaps, `0` convention breaks, and `0` readability breaches; 12 of 12 validation edit scripts match expectations and pass gate 4.
- `npm run bench -- --check`: exit `0`, `18 circuits, 18 valid. Total score 886.9 (baseline 886.9)`, 0 regressions.
- `npm run web:build`: exit `0`, `wrote out\web/ (main.js 40 KB, worker.js 441 KB, docs.js 1 KB)`.
- `npm run build`: exit `0`, `wrote dist/schem.js (585 KB) and dist/fonts/; external: @resvg/resvg-js, opentype.js`.
- `npm run pack:smoke`: exit `0`, `pack:smoke passed: schem-cli-0.0.1.tgz, 560.0 kB, 28 files` (all 15 install, CLI, `npx`, and 11-tool stdio MCP checks passed).
- `npm run gates` (default validation mode only): exit `0`, Gate 1 `8/8`, Gate 4 `12/12`, Gate 6 `generated #30 (16 patterns)` cold `861 ms`, warm median `767 ms`, warm p95 `801 ms` (`pass`, target `< 3000 ms`).

## Skipped and open items

- Did not open, read, or run held-out test paths (`--test` flags stayed untouched per `AGENTS.md`).
- Left `rc-rl-filter` (PR #5) and `OPAMP_INVERTING` `reserve: ["T"]` (`differentiator`) out because enabling them triggers existing test/snapshot/stability assertions (documented in `docs/general-layout.md` and `docs/agent-reports/neon-layout-polish.md`).
- Old parallel worktrees under `C:\Users\ntlak\.t3\worktrees\...`, `.codex\worktrees\...`, and `../schem-supply-chain` are still on disk if you want them pruned after merging `neon/usability-sprint`.
