# Benchmark layout pass (`neon/bench-15`)

## Summary

- **Branch:** `neon/bench-15` (branched from `main` at `3fa8f8e`)
- **Starting total ("before"):** `1075.4` across 18 circuits (18 of 18 valid)
- **Final total ("after", including Fix round):** `908.1` across 18 circuits (18 of 18 valid; `910.0` after Rounds 1-9)
- **Reduction:** `-167.3` points (**15.56%** cut; target was at least 15%, or at most `914.0`)
- **Per-circuit regressions:** 0 (13 circuits improved, 5 kept the same score, 0 scored worse)
- **Stale checked-in baseline (`bench/baseline.json`):** `1167.1` (not modified, per instructions)

All changes use general layout rules based on topology, symbol kinds, and pin directions. No rule tests a circuit name, part id, or component value.

### Files changed under `src/`

- `src/layout/layout.ts` (+188 / -26): wrap long IC and module labels, flip free op-amps vertically in the second-pass pin-order refinement, tuck standalone port-only headers and ICs into the shortest valid column, leave vertical clearance below bottom-edge wired pins, route mixed 3+-pin nets starting from horizontal pins, place decoupled IC host labels within the host footprint, and level same-direction vertical pins across columns for transistor pairs.
- `src/layout/stacks.ts` (+53 / -5): guard complementary push-pull transistor outputs from vertical load stacking, detect symmetric op-amp feedback bridges (`fbA - bridge - fbB`) as vertical stacks, and align bridge stack height to the host op-amp outputs.
- `src/layout/flow.ts` (+45 / -6): recognize 2-pin parts whose only outgoing edge is a cycle back-edge as feedback siblings, exclude feedback siblings from pulling load taps upstream, place symmetric op-amp feedback bridges half a column right of their host op-amps, and keep floating bypass capacitors in column 0 instead of splitting an IC-to-IC bus channel.
- `src/layout/templates/types.ts` (+7 / -2): add `forbidPin` net predicate and net-endpoint-count `When` predicates (`minEndpoints`, `maxEndpoints`) for template constraints and trunks.
- `src/layout/templates/engine.ts` (+24 / -13): evaluate net predicates even when a net variable is already bound, and evaluate `minEndpoints` / `maxEndpoints` conditions on template constraints and trunks.
- `src/layout/templates/library.ts` (+33 / -2): stagger the lower resistor 2 G right on voltage dividers whose tap net has 4 or more endpoints, forbid `opamp-inverting` from binding a gain resistor shared with another op-amp `IN-` pin, and add optional `rplus` and `rgnd` slots to `opamp-inverting` for 4-resistor difference amplifiers.

---

## Per-circuit scoreboard (all 18 benchmark circuits)

The benchmark runner (`npm run bench`, which executes `scripts/bench.ts`) draws the 18 circuits in `bench/circuits/` and scores each drawing with `scripts/lib/bench-score.ts` on wire crossings, bends, total wire length, label and convention findings, and layout compactness. Lower scores are better.

| Circuit | Before | After | Change | SVG changed |
|---|---:|---:|---:|---|
| `ce-amp` | 47.0 | 39.9 | -7.1 | yes |
| `current-sink` | 36.3 | 28.7 | -7.6 | yes |
| `darlington` | 41.6 | 36.3 | -5.3 | yes |
| `debounce` | 25.9 | 25.9 | 0.0 | no |
| `differentiator` | 63.0 | 63.0 | 0.0 | no |
| `follower` | 38.1 | 31.0 | -7.1 | yes |
| `highside` | 28.4 | 28.4 | 0.0 | no |
| `inamp` | 89.4 | 75.3 | -14.1 | yes |
| `levelshift` | 77.5 | 67.9 | -9.6 | yes |
| `mcu` | 86.4 | 72.0 | -14.4 | yes |
| `mixer-ce` | 63.5 | 56.4 | -7.1 | yes |
| `multivibrator` | 63.3 | 63.3 | 0.0 | no |
| `ne555` | 41.3 | 41.3 | 0.0 | yes |
| `pushpull` | 73.9 | 61.3 | -12.6 | yes |
| `regulator` | 40.3 | 38.9 | -1.4 | yes |
| `schmitt` | 41.7 | 32.6 | -9.1 | yes |
| `sensor-node` | 142.8 | 92.1 | -50.7 | yes |
| `shift` | 75.0 | 53.8 | -21.2 | yes |
| **Total** | **1075.4** | **908.1** | **-167.3 (-15.56%)** | **14 changed** |

Note on `ne555`: its score stayed `41.3`, and its SVG changed slightly in Round 8 because the horizontal-first 3+-pin net ordering shifted one bend on the `DIS` net slightly to the right (same bend count and wire length).

---

## Before and after images

Contact sheets for all 18 circuits (generated with `scripts/bench-sheet.ts`):
- Before: `docs/agent-reports/img/neon-bench-15/sheet-before.png`
- After: `docs/agent-reports/img/neon-bench-15/sheet-after.png`

Individual before/after PNG pairs for all 14 circuits whose SVG changed are committed in `docs/agent-reports/img/neon-bench-15/`:

| Circuit | Before | After |
|---|---|---|
| `ce-amp` | `img/neon-bench-15/ce-amp-before.png` | `img/neon-bench-15/ce-amp-after.png` |
| `current-sink` | `img/neon-bench-15/current-sink-before.png` | `img/neon-bench-15/current-sink-after.png` |
| `darlington` | `img/neon-bench-15/darlington-before.png` | `img/neon-bench-15/darlington-after.png` |
| `follower` | `img/neon-bench-15/follower-before.png` | `img/neon-bench-15/follower-after.png` |
| `inamp` | `img/neon-bench-15/inamp-before.png` | `img/neon-bench-15/inamp-after.png` |
| `levelshift` | `img/neon-bench-15/levelshift-before.png` | `img/neon-bench-15/levelshift-after.png` |
| `mcu` | `img/neon-bench-15/mcu-before.png` | `img/neon-bench-15/mcu-after.png` |
| `mixer-ce` | `img/neon-bench-15/mixer-ce-before.png` | `img/neon-bench-15/mixer-ce-after.png` |
| `ne555` | `img/neon-bench-15/ne555-before.png` | `img/neon-bench-15/ne555-after.png` |
| `pushpull` | `img/neon-bench-15/pushpull-before.png` | `img/neon-bench-15/pushpull-after.png` |
| `regulator` | `img/neon-bench-15/regulator-before.png` | `img/neon-bench-15/regulator-after.png` |
| `schmitt` | `img/neon-bench-15/schmitt-before.png` | `img/neon-bench-15/schmitt-after.png` |
| `sensor-node` | `img/neon-bench-15/sensor-node-before.png` | `img/neon-bench-15/sensor-node-after.png` |
| `shift` | `img/neon-bench-15/shift-before.png` | `img/neon-bench-15/shift-after.png` |

Every changed PNG was opened and visually checked after its round and again on the final commit.

---

## Round log

Each round tested one general layout idea, ran all four checks (`npm run typecheck`, `npm test`, `npm run phase0`, `npm run bench`), and visually inspected every changed PNG before committing or reverting.

### Kept rounds

1. **Round 1 (`08d7662`) - Wrap long IC and module labels (`src/layout/layout.ts`)**
   - **Idea:** Long single-line module descriptions stretched bounding boxes far past the schematic. Wrap IC and module value lines wider than 16 G (grid units) onto balanced lines targeting ~11 G, and place wrapped labels on the pin-free right side for non-template ICs that have no right-side pins.
   - **Adjustments before commit:** Earlier drafts wrapped at 12 G or 14 G and moved IC labels to the right unconditionally, which broke `tests/edits.test.ts` (`case05-i2c` stability dropped to 94.89% < 95%) and `tests/findings-snapshot.test.ts` (`generated-30-16`). Raising the trigger threshold to 16 G and scoping right-side preference to wrapped non-template ICs with no right pins kept all 585 tests passing.
   - **Result:** `sensor-node` `142.8 -> 112.0` (-30.8). Total `1075.4 -> 1044.6` (-2.86%).
   - **Status:** Kept.

2. **Round 2 (`f61aebb`) - Stagger lower resistor on 4-endpoint voltage dividers (`src/layout/templates/types.ts`, `engine.ts`, `library.ts`)**
   - **Idea:** When a bias divider tap has 4 or more endpoints (for example, an input coupling capacitor on the left and a transistor base on the right), the vertical lower resistor `rb` blocks the straight line from input to base, forcing the wire to loop under `rb`. Add net-endpoint-count `When` predicates to template constraints and trunks, and stagger `rb` 2 G right with a short horizontal trunk when `TAP` has at least 4 endpoints.
   - **Adjustments before commit:** Creating a separate template id (`voltage-divider-pass`) failed `tests/opamp-templates.test.ts`, which checks that `docs/templates.md` lists every template id. Keeping the single `id: "voltage-divider"` (`version: 1`) with conditional constraints avoided modifying `docs/templates.md` and preserved `tests/templates.test.ts`.
   - **Result:** `ce-amp` `47.0 -> 39.9` (-7.1), `follower` `38.1 -> 31.0` (-7.1), `mixer-ce` `63.5 -> 56.4` (-7.1). Total `1044.6 -> 1023.3` (-4.84%).
   - **Status:** Kept.

3. **Round 3 (`8992d10`) - Flip free op-amps vertically in the pin-order pass (`src/layout/layout.ts`)**
   - **Idea:** The second-pass pin-order refinement swapped pins on generated IC boxes but did not try flipping fixed `opamp` symbols vertically. For non-template, unlocked op-amps, test flipping between `{ rot: 0, flip: false }` and `{ rot: 180, flip: true }` when `IN+` and `IN-` connected heights are inverted, keeping the flip only if `(crossings, bends, wireLength)` strictly improves.
   - **Result:** `current-sink` `36.3 -> 28.7` (-7.6; crossings `1 -> 0`), `schmitt` `41.7 -> 32.6` (-9.1; crossings `1 -> 0`). Total `1023.3 -> 1006.6` (-6.40%).
   - **Status:** Kept.

4. **Round 4 (`89f431b`) - Push-pull output guard and multi-stage feedback placement (`src/layout/stacks.ts`, `src/layout/flow.ts`)**
   - **Idea:** In a complementary push-pull output stage, the shared emitter/source node connects two opposite-facing transistors; vertically stacking a load resistor on that node creates long loopbacks. Guard `stacks.ts` against stacking loads on a transistor pin shared with an opposite-facing transistor main/ref pin. In `flow.ts`, recognize 2-pin parts whose only outgoing edge is a cycle back-edge as feedback siblings of their upstream target, and exclude feedback siblings from pulling output load taps upstream.
   - **Result:** `pushpull` `73.9 -> 62.8` (-11.1; bends `11 -> 8`, wire `179 -> 139`). Total `1006.6 -> 995.5` (-7.43%).
   - **Status:** Kept.

5. **Round 5 (`ad04fcf`) - Symmetric op-amp feedback bridges and difference-amp `IN+` slots (`src/layout/templates/types.ts`, `engine.ts`, `library.ts`, `stacks.ts`, `flow.ts`, `layout.ts`)**
   - **Idea:** Instrumentation amplifiers have two input buffer op-amps coupled by a three-resistor vertical feedback ladder (`R1 - RG - R2`) feeding a 4-resistor difference amplifier (`U3`). Add `forbidPin` to `NetPred` so `opamp-inverting` does not falsely match a feedback resistor bridged to another op-amp's `IN-`; fix `engine.ts` to evaluate `sp.pred` even when a net variable is already bound; add optional `rplus` and `rgnd` slots to `opamp-inverting` for difference amplifiers; detect symmetric op-amp feedback bridges (`fbA - bridge - fbB`) in `stacks.ts`, place them half a column right of their host op-amps in `flow.ts`, orient the top op-amp with `IN+` on top, and align the two op-amp outputs to the outer ladder ends.
   - **Result:** `inamp` `89.4 -> 75.3` (-14.1; crossings `1 -> 0`, bends `14 -> 10`, wire `223 -> 191`). Total `995.5 -> 981.4` (-8.74%).
   - **Status:** Kept.

6. **Round 6 (`964fec1`) - Tuck standalone port-only headers and ICs into the shortest valid column (`src/layout/layout.ts`)**
   - **Idea:** Headers and ICs that connect only through named supply/ground ports (zero wired neighbours) were dropped into column 0 even when column 0 was already tall, inflating canvas height and aspect ratio. Move standalone port-only `header` and `ic` blocks into the shortest existing integer-rank column within their valid rail-flow range.
   - **Adjustments before commit:** Including `sym.kind === "source"` (standalone batteries) regressed `highside`, `ne555`, `current-sink`, and `follower` (see Reverted Experiment B below). Scoping the rule to `header` and `ic` parts kept batteries at the top-left supply corner while tucking power headers and port-only modules cleanly under shorter stages.
   - **Result:** `sensor-node` `112.0 -> 92.1` (-19.9), `mcu` `86.4 -> 78.6` (-7.8). Total `981.4 -> 953.7` (-11.32%).
   - **Status:** Kept.

7. **Round 7 (`0745d7e`) - Keep floating bypass capacitors out of IC-to-IC bus channels (`src/layout/flow.ts`, `src/layout/layout.ts`)**
   - **Idea:** Unhinted floating bypass capacitors on a rail with no dedicated driver were placed at fractional column `0 + k/64`, wedging a narrow column between column 0 (MCU) and column 1 (shift register) and forcing the entire multi-wire bus to route around the capacitor. When no rail driver feeds the capacitor's rail and column 0 already hosts an IC on that rail, stack the floating capacitor in column 0 below wired parts.
   - **Result:** `shift` `75.0 -> 55.7` (-19.3; bends `8 -> 4`, wire `170 -> 116`). Total `953.7 -> 934.4` (-13.11%).
   - **Status:** Kept.

8. **Round 8 (`26652b5`) - Clear bottom-edge wired pins and order mixed 3+-pin nets horizontal-first (`src/layout/layout.ts`)**
   - **Idea:** (a) When a stacked block has a wired down-facing pin on its bottom edge, leave 3 G vertical clearance below it so a horizontal tap at `pin.y + 2` clears the next block instead of taking a 1 G jog. (b) When routing a 3+-pin net that has both horizontal and vertical terminals, start from horizontal terminals so the main straight trunk forms first and vertical pins drop cleanly onto it without U-loops.
   - **Result:** `levelshift` `77.5 -> 69.4` (-8.1; jogs `1 -> 0`), `darlington` `41.6 -> 36.3` (-5.3; bends `8 -> 5`), `ne555` `41.3 -> 41.3` (minor bend shift, visually clean). Total `934.4 -> 921.0` (-14.36%).
   - **Status:** Kept.

9. **Round 9 (`41475e8`) - Align decoupler host labels within their footprint and level same-direction transistor pins (`src/layout/layout.ts`)**
   - **Idea:** (a) On an IC that carries decoupling capacitors, placing its label outside on the opposite side widens the bounding box unnecessarily. Try placing the label directly below the box first; if that collides, prefer the horizontal side that its decouplers already occupy (`below-right-out` when decouplers sit on the right half, else `below-left-out`). (b) Allow vertical pin leveling across columns for same-direction vertical pins when a transistor is involved so transistor drains/collectors/emitters line up cleanly with adjacent loads or rails.
   - **Adjustments before commit:** Leveling same-direction vertical pins on non-transistor parts changed the layout hash of `generated-30-16` in `tests/findings-snapshot.test.ts`. Scoping the rule to pairs involving a transistor kept `generated-30-16` byte-identical.
   - **Result:** `mcu` `78.6 -> 72.0` (-6.6), `regulator` `40.3 -> 38.9` (-1.4), `levelshift` `69.4 -> 67.9` (-1.5), `pushpull` `62.8 -> 61.3` (-1.5). Total `921.0 -> 910.0` (-15.38%).
   - **Status:** Kept.

### Reverted and rejected ideas

- **Experiment A (between Rounds 5 and 6) - Set `back = 0.5` for all multi-part input-side taps in `flow.ts`:**
  - Improved `differentiator` (`63.0 -> 57.4`), but severely regressed `mcu` (`86.4 -> 122.2`, +1 crossing, 3 breaches) and `sensor-node` (`112.0 -> 120.4`) because tall multi-part stacks sat directly in front of column-0 horizontal wires. **Reverted.**
- **Experiment B (during Round 6) - Tuck standalone `source` (battery) blocks into the shortest column:**
  - Regressed `highside` (`28.4 -> 32.0`), `ne555` (`41.3 -> 43.2`), `current-sink` (`28.7 -> 33.7`), and `follower` (`31.0 -> 32.1`), and moved batteries away from their conventional top-left corner. **Reverted** (kept only `header` and `ic`).
- **Experiment C (during Round 8) - Add `reserve: ["T"]` to `OPAMP_INVERTING` template:**
  - Eliminated the `squeezedRuns` finding on `differentiator` (`63.0 -> 58.7`), and also eliminated the `L-squeezedRuns` finding on `generated-30-16`. However, `tests/findings-snapshot.test.ts` pins the exact old findings snapshot (including `L-squeezedRuns`) for `generated-30-16`, and tests cannot be edited. **Reverted.**
- **Experiment D (during Round 9) - Put `power_out` on the right and `power_in` on the left in `icFor` (without rail-wire routing):**
  - Regressed `sensor-node` (`92.1 -> 103.9`) because port symbols on left/right power pins added stub bends and pushed the right-side wrapped label out. **Reverted.**

---

## Verification output on the final commit

All four required checks (plus `npm run bench -- --check`) were run on the final code (`41475e8`) and passed with exit code 0.

### 1. `npm run typecheck`

```text
> schem@0.0.1 typecheck
> tsc --noEmit && tsc --noEmit -p web

EXIT: 0
```

### 2. `npm test`

```text
> schem@0.0.1 test
> vitest run


 RUN  v2.1.8 C:/Users/ntlak/OneDrive/Documents/Schematic circuit

 ✓ tests/gates.test.ts (18 tests) 14ms
 ✓ tests/fixtures.test.ts (95 tests) 73ms
 ✓ tests/phase0-gates.test.ts (9 tests) 12ms
 ✓ tests/quality.test.ts (40 tests) 683ms
 ✓ tests/symbols.test.ts (116 tests) 529ms
 ✓ tests/findings.test.ts (8 tests) 1093ms
 ✓ tests/cli.test.ts (12 tests) 1199ms
   ✓ schem draw > draws examples/h-bridge.schem.json and says it is valid 644ms
 ✓ tests/opamp-templates.test.ts (19 tests) 1302ms
   ✓ Sallen-Key filters > low-pass, unity gain: series resistors in line into IN+, C1 above, C2 hanging from the IN+ line 439ms
 ✓ tests/decoupling.test.ts (9 tests) 1587ms
   ✓ decoupling child slots > places each hinted capacitor within 8 G of its specified pin and preserves topology 449ms
   ✓ decoupling child slots > keeps a no-op edit byte-identical 335ms
 ✓ tests/cli-edit.test.ts (13 tests) 1278ms
   ✓ schem edit > saves the edit, keeps the drawing, and draw shows the same drawing afterwards 387ms
 ✓ tests/templates.test.ts (26 tests) 1741ms
   ✓ template mechanics > are deterministic, and declaration order does not change the drawing (SPEC 9.6) 1152ms
 ✓ tests/router.test.ts (3 tests) 59ms
 ✓ tests/io.test.ts (39 tests) 2348ms
   ✓ project files: both shapes > the Phase 0a case and its drawing are the same whether read by the loader or as raw JSON 410ms
   ✓ edit scripts (SPEC 11.3) > applies each operation kind through the edit transaction 385ms
 ✓ tests/transistor-astable.test.ts (3 tests) 377ms
   ✓ keeps both timing paths inside the legs after reordering and renaming 312ms
 ✓ tests/mcp.test.ts (15 tests) 2211ms
   ✓ stdio > writes only JSON-RPC to stdout 1409ms
 ✓ tests/render.test.ts (9 tests) 92ms
 ✓ tests/chip-fanout.test.ts (3 tests) 581ms
   ✓ shift: overlapping output branches stagger and take one bend each 375ms
 ✓ tests/sha256.test.ts (2 tests) 22ms
 ✓ tests/general-layout.test.ts (34 tests) 2826ms
   ✓ flow inference > the astable bases face inward and other active parts follow signal flow 1542ms
 ✓ tests/appendix-a.test.ts (6 tests) 9ms
 ✓ tests/pipeline.test.ts (18 tests) 209ms
 ✓ tests/web.test.ts (7 tests) 3529ms
   ✓ playground engine (web/core.ts) > draws every example exactly as the command line does 1544ms
   ✓ playground engine (web/core.ts) > after the browser build, still draws every example byte-identically 1971ms
 ✓ tests/findings-snapshot.test.ts (10 tests) 2346ms
   ✓ findings snapshot (SPEC 10.2 output unchanged by the gate 6 speed-up) > generated-30-16 1676ms
 ✓ tests/edits.test.ts (26 tests) 6424ms
   ✓ generated circuits under random edits (layer 5) > every saved edit passes layers 1-2, and at least 95% meet the stability gate 4682ms
 ✓ tests/generated.test.ts (45 tests) 7380ms
   ✓ generated circuits > 300 circuits: no crash, and valid only if the drawing passes layers 1 and 2 5252ms
   ✓ generated circuits > are deterministic (byte-identical SVG on a second run) 744ms

 Test Files  25 passed (25)
      Tests  585 passed (585)
   Start at  14:06:05
   Duration  8.88s (transform 3.59s, setup 0ms, collect 16.59s, tests 37.92s, environment 7ms, prepare 6.51s)

EXIT: 0
```

### 3. `npm run phase0`

```text
> schem@0.0.1 phase0
> tsx scripts/phase0.ts

case                           status                             verifier  overlaps conv read ms
case01-led                     valid                              valid     0        0    0    70
case02-divider-buffer          valid                              valid     0        0    0    26
case03-summing                 valid                              valid     0        0    0    7
case04-hbridge                 valid                              valid     0        0    0    107
case05-i2c                     valid                              valid     0        0    0    6
case06-esp32-relay             valid                              valid     0        0    0    11
case07-two-ic-decoupling       valid                              valid     0        0    0    10
case08-diffpair                valid                              valid     0        0    0    5

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
EXIT: 0
```

### 4. `npm run bench` (and `npm run bench -- --check`)

```text
> schem@0.0.1 bench
> tsx scripts/bench.ts

circuit           status                   score     was  cross  bends  wire  conv  limit  back  upstr
ce-amp            valid                     39.9      47      0      3    66     0      0     0      0 better
current-sink      valid                     28.7    36.3      0      2    49     0      0     0      0 better
darlington        valid                     36.3    41.6      0      5    59     0      0     0      0 better
debounce          valid                     25.9    25.9      0      1    49     0      0     0      0
differentiator    valid                       63      63      0      7    87     0      1     0      0
follower          valid                       31    38.1      0      2    45     0      0     0      0 better
highside          valid                     28.4    28.4      0      2    37     0      0     0      0
inamp             valid                     75.3    89.4      0     10   191     0      0     0      0 better
levelshift        valid                     67.9    77.5      0     12   147     0      0     0      0 better
mcu               valid                       72    86.8      0     10   140     0      0     0      0 better
mixer-ce          valid                     56.4    63.5      0      8    93     0      0     0      0 better
multivibrator     valid                     63.3    68.7      2      2    74     0      0     1      0 better
ne555             valid                     41.3    41.3      0      5    78     0      0     0      0
pushpull          valid                     61.3   134.2      0      7   139     0      0     0      0 better
regulator         valid                     38.9    40.3      0      5    35     0      0     0      0 better
schmitt           valid                     32.6    41.7      0      3    58     0      0     0      0 better
sensor-node       valid                     92.1   142.8      0      8   152     0      0     0      0 better
shift             valid                     55.7   100.6      0      4   116     1      0     0      0 better

18 circuits, 18 valid. Total score 910 (baseline 1167.1). Images: out/bench/index.html
EXIT: 0
```

`npm run bench -- --check` produced the identical table above and exited with code `0`.

---

## Skipped items and open questions

1. **Snapshot lock on `generated-30-16` (`tests/findings-snapshot.test.ts`):** Adding `reserve: ["T"]` to `OPAMP_INVERTING` cleanly removes the `squeezedRuns` finding on both `differentiator` (`63.0 -> 58.7`) and `generated-30-16`, and relaxing same-direction vertical pin leveling beyond transistors could help other circuits. Both were left out because `tests/findings-snapshot.test.ts` pins the old layout hash and findings array for `generated-30-16` and `tests/` could not be edited. Question for maintainers: should `OPAMP_INVERTING` reserve `"T"` and have the snapshot refreshed in a follow-up?
2. **Voltage regulators with wired rails (Open Job 1 in `docs/general-layout.md`):** Turning `IN` and `OUT` on a 3-terminal regulator (`regulator`) into a left-to-right wired rail instead of named power ports requires coordinated changes in `ports.ts` (deciding which rail nets stay wired vs. become ports) and `decoupling.ts`. Simply moving `power_in` and `power_out` pins to the left and right sides in `icFor` while keeping ports regressed `sensor-node` (`92.1 -> 103.9`). Left for a dedicated follow-up issue.
3. **Convention finding `C13-C1` on `shift` (resolved in Fix round):** In Rounds 1-9, `C1` stayed far from `U1` (`conv = 1`). The Fix round below moves left-side floating bypass capacitors directly beside their column-0 IC with outward labels, placing `C1` within `8 G` of `U1[VCC]` and clearing `C13-C1` (`conv = 0`) without guessing a `decoupling@1:` slot.
4. **Voltage-divider stagger direction on `sensor-node`:** On `sensor-node`, `R1`/`R2` has 4 tap endpoints (`R1`, `R2`, `C1`, and `U1`), so Round 2 staggers `R2` 2 G right even though all downstream parts sit on the right. Visually and score-wise it is neutral, and could later be refined to trigger only when the tap has endpoints on both left and right sides.
5. **Held-out test set:** Per `AGENTS.md`, nothing under `phase0/cases/test/`, `phase0/cases/edits/case11-*`, `baselines/LOG-test.md`, `baselines/out/*/test/`, or `baselines/out/_netlist/test/` was read or executed, and neither `npm run gates -- --test` nor `npm run phase0 -- --test` was run. `bench/baseline.json` was not updated (`npm run bench -- --update` was not run).

---

## Fix round

Follow-up commit `f863731` addressed both drawings flagged in review using general rules in `src/layout/layout.ts` and `src/layout/flow.ts`.

### Changes made (`f863731`)

1. **Keep tucked port-only blocks out of wire paths (`src/layout/layout.ts`):**
   - In the Round 6 rule that tucks standalone port-only headers and ICs into a shorter column, skip any candidate column `c` crossed by a wired net whose endpoints lie strictly on both sides of `c` (`min(cols) < c && max(cols) > c`).
   - Also require the target column to have enough vertical slack to absorb the block without exceeding the home column's height (`colH(c) + idH <= curH`), so a block does not jump across the sheet for a negligible height difference.
   - Effect on `case07-two-ic-decoupling`: connector `J1` (`5V IN`) stays alone at the top-left instead of moving between `U1` and `U2`, and both `SDA` and `SCL` bus wires run straight with zero detours. Benchmark `mcu` (`72.0`) and `sensor-node` (`92.1`) keep their exact Round 6 gains.

2. **Place floating bypass capacitors beside their column-0 IC (`src/layout/flow.ts`, `src/layout/layout.ts`):**
   - Replaced Round 7's bottom-of-column stacking rule (`col = base` plus post-sweep bottom-push) with placing floating bypass capacitors immediately to the left of column `base` (`col = base - k/64`) when no rail driver feeds the rail and column `base` already hosts an IC on that rail.
   - When a port-only bypass capacitor sits in the column directly to the left of an IC on its supply rail, prefer `"left"` for the capacitor's label (outward, matching `decoupling@1` left-side convention) and prefer right-side label slots for the IC so the IC's label does not push the capacitor away from its supply pin.
   - In incremental edits (`opts.previous`), clamp a newly added unattached part's column to at least `minOld` so adding a new floating capacitor (as in `case05-add-part`) does not insert a column left of the existing schematic and slide untouched parts right.
   - Effect on `shift`: `C1` sits directly beside `U1` at the top-left, completely outside the `U1`-to-`U2` bus channel, within 8 G of `U1[VCC]`. This clears the `C13-C1` convention warning (`conv: 1 -> 0`) and lowers `shift` from `55.7` to **`53.8`** (updated image in `docs/agent-reports/img/neon-bench-15/shift-after.png` and `sheet-after.png`). Total benchmark score drops from `910.0` to **`908.1`** (**-167.3** points, **15.56%** cut from `1075.4`), with every other benchmark circuit unchanged.

### Comparison of all 8 validation drawings against `main`

Built `main` (`d3fe269`) in a separate detached git worktree (`out/main-wt`, removed after comparison) and ran `npm run phase0` in both worktrees. Every changed validation PNG was opened and compared side by side with `main`.

| Validation case | Diff vs `main` | One-line verdict |
|---|---|---|
| `case01-led` | identical | Unchanged from `main` (byte-identical SVG). |
| `case02-divider-buffer` | changed | Better: `R2` staggers 2 G right and `U1` flips `IN+` to the top so the divider tap runs straight through `C1` into `U1` with no jog. |
| `case03-summing` | identical | Unchanged from `main` (byte-identical SVG). |
| `case04-hbridge` | identical | Unchanged from `main` (byte-identical SVG). |
| `case05-i2c` | identical | Unchanged from `main` (byte-identical SVG). |
| `case06-esp32-relay` | identical | Unchanged from `main` (byte-identical SVG). |
| `case07-two-ic-decoupling` | changed | Better/neutral: `J1` stays at top-left and both `SDA`/`SCL` bus wires run straight as on `main`; only `U2`'s label moves to bottom-right under `C3`/`C4`, trimming 30 px of width. |
| `case08-diffpair` | changed | Neutral/slightly cleaner: identical topology and routing, with `V2` shifted 1 G down to give `V3`'s bottom wire 3 G clearance above `V2`'s `+12V` port. |

### Verification output on Fix round commit (`f863731`)

#### 1. `npm run typecheck`

```text
> schem@0.0.1 typecheck
> tsc --noEmit && tsc --noEmit -p web

EXIT: 0
```

#### 2. `npm test`

```text
> schem@0.0.1 test
> vitest run

 Test Files  25 passed (25)
      Tests  585 passed (585)
   Start at  16:49:40
   Duration  7.33s (transform 3.51s, setup 0ms, collect 14.58s, tests 34.01s, environment 7ms, prepare 6.17s)

EXIT: 0
```

#### 3. `npm run phase0`

```text
> schem@0.0.1 phase0
> tsx scripts/phase0.ts

case                           status                             verifier  overlaps conv read ms
case01-led                     valid                              valid     0        0    0    69
case02-divider-buffer          valid                              valid     0        0    0    29
case03-summing                 valid                              valid     0        0    0    7
case04-hbridge                 valid                              valid     0        0    0    100
case05-i2c                     valid                              valid     0        0    0    7
case06-esp32-relay             valid                              valid     0        0    0    10
case07-two-ic-decoupling       valid                              valid     0        0    0    10
case08-diffpair                valid                              valid     0        0    0    6

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
EXIT: 0
```

#### 4. `npm run bench` (and `npm run bench -- --check`)

```text
> schem@0.0.1 bench
> tsx scripts/bench.ts

circuit           status                   score     was  cross  bends  wire  conv  limit  back  upstr
ce-amp            valid                     39.9      47      0      3    66     0      0     0      0 better
current-sink      valid                     28.7    36.3      0      2    49     0      0     0      0 better
darlington        valid                     36.3    41.6      0      5    59     0      0     0      0 better
debounce          valid                     25.9    25.9      0      1    49     0      0     0      0
differentiator    valid                       63      63      0      7    87     0      1     0      0
follower          valid                       31    38.1      0      2    45     0      0     0      0 better
highside          valid                     28.4    28.4      0      2    37     0      0     0      0
inamp             valid                     75.3    89.4      0     10   191     0      0     0      0 better
levelshift        valid                     67.9    77.5      0     12   147     0      0     0      0 better
mcu               valid                       72    86.8      0     10   140     0      0     0      0 better
mixer-ce          valid                     56.4    63.5      0      8    93     0      0     0      0 better
multivibrator     valid                     63.3    68.7      2      2    74     0      0     1      0 better
ne555             valid                     41.3    41.3      0      5    78     0      0     0      0
pushpull          valid                     61.3   134.2      0      7   139     0      0     0      0 better
regulator         valid                     38.9    40.3      0      5    35     0      0     0      0 better
schmitt           valid                     32.6    41.7      0      3    58     0      0     0      0 better
sensor-node       valid                     92.1   142.8      0      8   152     0      0     0      0 better
shift             valid                     53.8   100.6      0      4   122     0      0     0      0 better

18 circuits, 18 valid. Total score 908.1 (baseline 1167.1). Images: out/bench/index.html
EXIT: 0
```

`npm run bench -- --check` produced the identical table and exited with code `0`.
