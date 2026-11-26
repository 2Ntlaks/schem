# Playground .schem Text DSL Support Report

- Branch: `t3/a2cf549b` (isolated git worktree; not on `main`)
- Worktree path: `C:/Users/ntlak/.t3/worktrees/Schematic circuit/t3-a2cf549b-879da71603c95744`
- Commits:
  - `f212f43` Support .schem text DSL in playground engine and browser bundle
  - `5d58a10` Add .schem editing, highlighting, conversion and downloads to playground UI
  - `37811aa` Add DSL, templates and install docs with .schem playground links
  - `436bb4b` Add playground and docs tests for .schem text DSL

## What was done

1. **Playground engine and browser bundle (`web/core.ts`, `web/highlight.ts`, `web/tidy-json.ts`, `scripts/lib/web-bundle.ts`)**
   - Added `detectFormat(text)` to classify circuit text as `"json"` (when trimmed text starts with `{` or `[`) or `"dsl"` (the `.schem` text domain-specific language).
   - Updated `draw(text)` to compile `.schem` files with `compileDsl` from `src/core/dsl.ts` and preserve optional trailing `# schem-layout:` cache comments. DSL syntax and semantic errors report 1-based line and column positions from DSL spans. JSON files keep the exact `JSON.parse` + `jsonProblem` + `loadProject` path and draw byte-identically to the command line interface (CLI).
   - Exported `convertCircuit(text, to)` using `formatDsl` and `saveProject`. When JSON contains fields that `.schem` cannot represent (such as `meta.created`, `ext`, or a saved JSON `layout`), `convertCircuit` returns `ok: false` with `lostFields` and a plain error message.
   - Exported `tidyCircuit(text)` for both JSON (one part and one net per line) and `.schem` (canonical `formatDsl` output, keeping any trailing `# schem-layout:` cache comment).
   - Added a browser-safe `isDeepStrictEqual` shim for `node:util` in `scripts/lib/web-bundle.ts` so `formatDsl` runs cleanly in browsers without Node.js disk reads or runtime imports.
   - Updated `scripts/lib/web-bundle.ts` so `virtual:examples` bundles both `.schem.json` and `.schem` files from `examples/` (including `led.schem`).

2. **Playground editor and worker (`web/worker.ts`, `web/main.ts`, `web/index.html`, `web/style.css`)**
   - Extended the Web Worker (the background thread that runs the layout engine) to handle `tidy` and `convert` messages alongside `draw`, keeping `main.js` small (39 KB).
   - Added `.schem` syntax highlighting in `web/highlight.ts` for statement keywords (`circuit`, `style`, `part`, `net`, `connect`, `chain`, `nc`, `hint`, `group`, `lock`, `override`), sub-keywords, `# ...` comments, quoted strings, `key=value` options, pin endpoints, numbers and quantities, and operators (`=`, `->`). All highlight classes change colour only so textarea caret alignment stays exact.
   - Added a `To .schem` / `To JSON` conversion button next to `Tidy`. When JSON to `.schem` conversion hits unsupported fields, the page shows both a toast and a note in the title block's problem list.
   - Updated `Tidy` to format whichever syntax (`.schem` or JSON) is in the editor.
   - Updated the Parts panel click-to-insert handler so clicking a part inserts a valid `.schem` `part` line (such as `part R2 resistor 10k`, or inline `pins:` for `ic` and `header`) when editing `.schem`, and valid JSON when editing JSON.
   - Added `Circuit file, .schem` to the Download menu alongside JSON, SVG, PNG, and share links. Both `.schem` and JSON downloads convert automatically if the editor is currently in the other format. Share links pack and unpack `.schem` text and set the editor file name to `shared.schem` or `shared.schem.json`.
   - Updated the Examples dropdown to list and load `.schem` files from `virtual:examples`.

3. **Documentation page (`scripts/lib/docs-page.ts`)**
   - Added `docs/dsl.md` ("Text schematics"), `docs/templates.md` ("Recognised circuits"), and `docs/install.md` ("Installing schem") to `SECTIONS` in `docs.html`.
   - Added "Open in the playground" buttons and `.schem` syntax highlighting for valid `text` and `schem` fenced code blocks that compile cleanly to a circuit with at least one part.
   - Kept internal doc cross-links resolving to in-page anchors and repository links pointing to GitHub.

4. **Tests (`tests/web.test.ts`)**
   - Kept every existing test untouched and added tests covering:
     - `.schem` examples drawing byte-identically to the CLI and JSON counterparts, both unbundled and after the esbuild browser build (also exercising `virtual:examples` and the `node:util` shim on `esp32-relay.schem.json`).
     - `.schem` syntax, semantic, and unknown-part errors reporting 1-based line and column numbers.
     - `convertCircuit` round-tripping `.schem` and JSON, `tidyCircuit` on both formats, and `convertCircuit` reporting lossy fields (`ext`, `meta.created`).
     - `highlightDsl` character preservation.
     - `docs.html` including `dsl`, `templates`, and `install` sections and every playground-openable JSON and `.schem` circuit drawing `valid`.

## Files changed

- `web/highlight.ts` (new)
- `web/tidy-json.ts` (new)
- `web/core.ts`
- `web/worker.ts`
- `web/main.ts`
- `web/index.html`
- `web/style.css`
- `scripts/lib/web-bundle.ts`
- `scripts/lib/docs-page.ts`
- `tests/web.test.ts`
- `docs/agent-reports/neon-playground-dsl.md` (this report)

## Verification command outputs

### `npm run typecheck`

```text
> schem-cli@0.0.1 typecheck
> tsc --noEmit && tsc --noEmit -p web
```
Exit code: 0.

### `npm run web:build`

```text
> schem-cli@0.0.1 web:build
> tsx scripts/web.ts build

wrote out\web/ (main.js 39 KB, worker.js 412 KB, docs.js 1 KB)
```
Exit code: 0.

### `npm run phase0`

```text
> schem-cli@0.0.1 phase0
> tsx scripts/phase0.ts

case                           status                             verifier  overlaps conv read ms
case01-led                     valid                              valid     0        0    0    153
case02-divider-buffer          valid                              valid     0        0    0    42
case03-summing                 valid                              valid     0        0    0    15
case04-hbridge                 valid                              valid     0        0    0    190
case05-i2c                     valid                              valid     0        0    0    13
case06-esp32-relay             valid                              valid     0        0    0    23
case07-two-ic-decoupling       valid                              valid     0        0    0    22
case08-diffpair                valid                              valid     0        0    0    8

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
Exit code: 0. All 8 validation cases are `valid` with 0 overlaps.

### `npm test`

```text
> schem-cli@0.0.1 test
> vitest run

 Test Files  32 passed (32)
      Tests  672 passed (672)
   Start at  14:49:56
   Duration  29.90s
```
Exit code: 0. All 13 tests in `tests/web.test.ts` passed.

## Skipped or not applicable

- `npm run bench -- --check` was not run because no files under `src/layout/` were edited.
- No PNG files were created or modified in the repository, so no PNG visual inspection was needed.
- `npm ci` was run once in the fresh worktree to install locked dependencies from `package-lock.json` without modifying `package.json`.

## Open questions

- `examples/esp32-relay.schem.json` and `examples/h-bridge.schem.json` include `meta.created`, which `formatDsl` refuses as an unsupported field in `.schem`. Right now clicking `To .schem` on those examples clearly explains that `meta.created` has no text form and leaves the JSON unchanged. If maintainers later want a "Convert anyway (drop unsupported fields)" action in the UI, that can be added cleanly as a follow-up.
