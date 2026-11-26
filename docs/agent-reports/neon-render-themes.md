# Render themes implementation report

- **Branch:** `t3/e77f0e9f`
- **Worktree path:** `C:\Users\ntlak\.t3\worktrees\Schematic circuit\t3-e77f0e9f-77d063187587b75d`
- **Implementation commits:**
  - `d5cf8d3` Add rendering themes and transparent background support to SVG and PNG renderers
  - `062a498` Add tests for render themes, transparency, meta fallback, and determinism
  - `afd8d46` Document rendering themes and add themed summing-amp sample PNGs

## What was done

1. Added `src/render/themes.ts` with the five SPEC 12.1 themes (`clean`, `dark`, `blueprint`, `textbook`, `mono-print`), `ThemeName`, `ThemeDef`, `THEMES`, `THEME_NAMES`, and `resolveTheme(name?: string)`. Unknown theme names throw an error listing all valid names.
   - `clean`: `#ffffff` background, `#000000` stroke, fill, and text.
   - `dark`: `#0f172a` background, `#e2e8f0` stroke and fill, `#f8fafc` text.
   - `blueprint`: `#0b2545` background, `#eef6ff` stroke and fill, `#ffffff` text.
   - `textbook`: `#faf7f0` background, `#1c1917` stroke, fill, and text.
   - `mono-print`: `#ffffff` background, `#000000` stroke, fill, and text.
2. Added optional `theme?: string` to `RenderModel["meta"]` in `src/render/model.ts`.
3. Updated `toSvg(m, options?)` in `src/render/svg.ts` with `SvgOptions` (`{ theme?: ThemeName | string; transparent?: boolean }`). Theme resolution checks `options?.theme ?? m.meta.theme ?? "clean"`. When `options?.transparent` is true, the background `<rect>` is omitted. Calling `toSvg(m)` with default or `clean` options emits byte-for-byte identical SVG to the previous code.
4. Updated `toPng(svg, pxPerGrid = 10, options?)` in `src/render/png.ts` with `PngOptions` (`{ transparent?: boolean; background?: string | null }`). When `options?.transparent` is true or `options?.background === null`, `background` is omitted from the `Resvg` options so PNG alpha transparency is preserved. Calling `toPng(svg)` without options retains `background: "#ffffff"` for byte-for-byte backwards compatibility.
5. Added `tests/themes.test.ts` covering theme definitions, byte-identity of `clean` vs default SVG and PNG, per-theme SVG colours and rendered PNG corner pixels, `transparent: true` and `background: null` (verifying no `<rect>`, PNG color type 6 RGBA, corner pixel alpha = 0, and opaque ink pixels), custom PNG background overrides, `meta.theme` fallback and override precedence, invalid theme error messages, and byte-for-byte determinism across runs.
6. Rendered `examples/summing-amp.schem.json` at 20 px per grid unit into `docs/agent-reports/img/themes/` for all five themes plus transparent light and transparent dark PNGs, and visually opened and inspected all seven PNGs. Contrast, legibility, junction dots, symbols, and alpha backgrounds are clean with no white fringe or edge artifacts.
7. Wrote `docs/themes.md` explaining the five themes, `style theme=...` in `.schem` files, `intent.style.theme` in JSON files, and the `toSvg` / `toPng` options.

## Files changed

- `src/render/themes.ts` (new)
- `src/render/model.ts` (modified)
- `src/render/svg.ts` (modified)
- `src/render/png.ts` (modified)
- `tests/themes.test.ts` (new)
- `docs/themes.md` (new)
- `docs/agent-reports/img/themes/summing-amp-clean.png` (new)
- `docs/agent-reports/img/themes/summing-amp-dark.png` (new)
- `docs/agent-reports/img/themes/summing-amp-blueprint.png` (new)
- `docs/agent-reports/img/themes/summing-amp-textbook.png` (new)
- `docs/agent-reports/img/themes/summing-amp-mono-print.png` (new)
- `docs/agent-reports/img/themes/summing-amp-transparent-light.png` (new)
- `docs/agent-reports/img/themes/summing-amp-transparent-dark.png` (new)
- `docs/agent-reports/neon-render-themes.md` (new)

## Verification commands and exact outputs

### `npm run typecheck`

Exit code: `0`

```text
> schem-cli@0.0.1 typecheck
> tsc --noEmit && tsc --noEmit -p web
```

### `npm test`

Exit code: `0`

```text
> schem-cli@0.0.1 test
> vitest run


 RUN  v2.1.8 C:/Users/ntlak/.t3/worktrees/Schematic circuit/t3-e77f0e9f-77d063187587b75d

 ✓ tests/gates.test.ts (18 tests) 33ms
 ✓ tests/dsl.test.ts (23 tests) 610ms
 ✓ tests/power-path.test.ts (11 tests) 1065ms
 ✓ tests/power-path-layout.test.ts (8 tests) 1172ms
 ✓ tests/quality.test.ts (40 tests) 1226ms
 ✓ tests/symbols.test.ts (116 tests) 1332ms
 ✓ tests/themes.test.ts (12 tests) 2100ms
 ✓ tests/opamp-templates.test.ts (19 tests) 2935ms
 ✓ tests/decoupling.test.ts (9 tests) 2556ms
 ✓ tests/fixtures.test.ts (95 tests) 226ms
 ✓ tests/io.test.ts (39 tests) 4542ms
 ✓ tests/templates.test.ts (26 tests) 3882ms
 ✓ tests/phase0-gates.test.ts (9 tests) 24ms
 ✓ tests/dsl-format.test.ts (4 tests) 81ms
 ✓ tests/findings.test.ts (8 tests) 1830ms
 ✓ tests/bridges.test.ts (5 tests) 614ms
 ✓ tests/cli-edit.test.ts (13 tests) 3605ms
 ✓ tests/cli.test.ts (12 tests) 2460ms
 ✓ tests/dsl-cli.test.ts (9 tests) 4598ms
 ✓ tests/mcp.test.ts (15 tests) 4718ms
 ✓ tests/router.test.ts (3 tests) 105ms
 ✓ tests/sha256.test.ts (2 tests) 61ms
 ✓ tests/appendix-a.test.ts (6 tests) 19ms
 ✓ tests/render.test.ts (9 tests) 166ms
 ✓ tests/general-layout.test.ts (34 tests) 7859ms
 ✓ tests/transistor-astable.test.ts (3 tests) 1065ms
 ✓ tests/chip-fanout.test.ts (3 tests) 1345ms
 ✓ tests/pipeline.test.ts (18 tests) 612ms
 ✓ tests/dsl-corpus.test.ts (21 tests) 4073ms
 ✓ tests/web.test.ts (7 tests) 7143ms
 ✓ tests/findings-snapshot.test.ts (10 tests) 5460ms
 ✓ tests/edits.test.ts (26 tests) 13204ms
 ✓ tests/generated.test.ts (45 tests) 11980ms

 Test Files  33 passed (33)
      Tests  678 passed (678)
   Start at  14:44:35
   Duration  18.95s (transform 7.79s, setup 0ms, collect 38.16s, tests 92.70s, environment 20ms, prepare 15.90s)
```

### `npm run phase0`

Exit code: `0`

```text
> schem-cli@0.0.1 phase0
> tsx scripts/phase0.ts

case                           status                             verifier  overlaps conv read ms
case01-led                     valid                              valid     0        0    0    146
case02-divider-buffer          valid                              valid     0        0    0    52
case03-summing                 valid                              valid     0        0    0    16
case04-hbridge                 valid                              valid     0        0    0    187
case05-i2c                     valid                              valid     0        0    0    15
case06-esp32-relay             valid                              valid     0        0    0    23
case07-two-ic-decoupling       valid                              valid     0        0    0    23
case08-diffpair                valid                              valid     0        0    0    12

edit script                status                             expect as exp affected mode                gate 4
case03-longer-value        saved                              true   true   same     incremental         pass (untouched 8, mean 0 G, max 0 G, other routes 0)
case03-add-part            saved                              true   true   same     incremental         pass (untouched 3, mean 0 G, max 0 G, other routes 0)
case03-remove-part         saved                              true   true   differs  incremental         pass (untouched 6, mean 0 G, max 0 G, other routes 0)
    affected: frozen expect (rev C.2 table) Rf U1 V1 V2 V3; recomputed (rev C.3, used by gate 4) Rf U1
case03-pin-sides           rejected (invalid_input)           either true   -        -                   -
    E270 setPinSides: U1 is the fixed "opamp" symbol; only generated boxes (ic, header, modules) have pin sides. The same arrangement is setOrientation { part: "U1", rot: 180, flip: true }.
case05-longer-value        saved                              true   true   same     incremental         pass (untouched 4, mean 1 G, max 4 G, other routes 1)
case05-add-part            saved                              true   true   differs  incremental         pass (untouched 5, mean 0 G, max 0 G, other routes 0)
    affected: frozen expect (rev C.2 table) C1 R1 R2 U1 U2 U3; recomputed (rev C.3, used by gate 4) C1
case05-remove-part         saved                              true   true   same     incremental         pass (untouched 0, mean 0 G, max 0 G, other routes 0)
case05-pin-sides           saved                              true   true   same     incremental         pass (untouched 4, mean 0 G, max 0 G, other routes 0)
case07-longer-value        saved                              true   true   same     incremental         pass (untouched 9, mean 0 G, max 0 G, other routes 0)
case07-add-part            saved                              true   true   differs  incremental         pass (untouched 8, mean 0 G, max 0 G, other routes 0)
    affected: frozen expect (rev C.2 table) C1 C2 C3 C4 C5 J1 R1 U1 U2; recomputed (rev C.3, used by gate 4) C5 R1 U1
case07-remove-part         saved                              true   true   differs  incremental         pass (untouched 8, mean 0.5 G, max 4 G, other routes 0)
    affected: frozen expect (rev C.2 table) C1 C2 C3 J1 R1 R2 R3 U1 U2; recomputed (rev C.3, used by gate 4) U2
case07-pin-sides           saved                              true   true   same     incremental         pass (untouched 9, mean 0 G, max 0 G, other routes 0)

wrote out/phase0/ (validation, edits)
gate 1: incomplete (8/12 results): Validation subset only; reserved test cases have not been evaluated.
gate 2: incomplete (0/12 results): Blind owner ratings before and after the permitted agent edit are not collected by this runner.
gate 3: incomplete (0/8 results): Validation-set blind owner ratings are not collected by this runner.
gate 4: incomplete (12/16 results): Validation subset only; reserved test cases have not been evaluated.
gate 5: incomplete (0/12 results): Blind owner comparisons with the baselines are not collected by this runner.
gate 6: incomplete (0/2 results): Full-pipeline warm p95 benchmarks on case 11 and a generated 30-part circuit are not collected by this runner.
```

## Skipped or out of scope

- `npm run bench -- --check` was not run because `src/layout/` was not modified.
- Wiring `project.intent.style.theme` into `src/layout/layout.ts`, `src/cli.ts`, `src/mcp/`, and `web/` was not done because those paths are outside this task's strict file ownership.

## Open questions

- Downstream callers (`src/layout/layout.ts`, `src/cli.ts`, `src/mcp/`, `web/`) can now pass `project.intent?.style?.theme` onto `RenderModel.meta.theme` or directly to `toSvg(render, { theme, transparent })` and `toPng(svg, scale, { transparent })` in a follow-up integration change.
