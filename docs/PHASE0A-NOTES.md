# Phase 0a: build notes

Status on 2026-10-23: Phase 0a is complete. Gates 1 and 2 pass, and the owner passed gate 3 ("promising").

| Gate (SPEC 15) | Result |
|---|---|
| 1. Verifier counterexample suite passes | 94 of 94 black-box fixtures pass (53 verifier, 41 model), written independently from SPEC.md |
| 2. Cases 1, 3, 5 lay out `valid` and pass the verifier | All three `valid`; verifier finds no errors |
| 3. Owner looks at the drawings | Passed 2026-10-23: owner's verdict "promising" on `out/case01-led.png`, `out/case03-summing.png`, `out/case05-i2c.png` |

## How the output is verified

1. **Independent fixtures.** A separate agent wrote `tests/fixtures/` from SPEC.md and `tests/fixtures/README.md` only, without seeing `src/`. Its notes on spec ambiguities are in `tests/fixtures/AUTHOR-NOTES.md`.
2. **Independent verifier.** `src/verify` rebuilds connectivity from the drawn primitives only. A test enforces that it imports nothing from `src/layout`.
3. **Mutation tests** (`tests/pipeline.test.ts`). For every case, each wire, junction dot and hidden pin is removed one at a time, and each port is relabelled: the verifier must reject every mutant.
4. **Determinism.** Each case is laid out twice; the SVG output must be byte-identical.
5. **Looking at it.** Every case is rendered to PNG (`npm run draw`) and inspected.

Run everything with `npm test` and `npm run draw`.

## Where the 0a code differs from SPEC.md (to fold into the spec before 0b)

| Area | SPEC says | 0a does | Why |
|---|---|---|---|
| Sources for ranking (9.2 step 2) | pins with role `output` / `power_out` are sources | only source parts, `controller` parts and `flow=input` parts | an op-amp's OUT pin made the op-amp a source and broke the summing-amp ranks |
| Nets ignored for flow (9.2 step 2) | power and ground nets | ground nets and nets drawn as ports; wired supply nets carry flow | a wired battery loop (case 1) needs its supply net to rank the resistor after the battery |
| Taps | not specified | a two-pin part with one wired pin and one port goes half a column upstream | puts pull-ups between the controller and the peripherals (case 5) |
| Router terminal order (9.2 step 7) | canonical order | nearest to the existing tree first, ties by canonical order | shorter trees, still deterministic |
| Repair (not in 0a list) | none in 0a | if routing fails, spacing +2 G, at most 3 times | cheap, deterministic, needed while label placement is simple |
| Straight-wire pass (9.2 step 6) | pairs of sideways pins | also one-bend pairs (sideways pin to an up/down pin, 2 G beyond it) | case 1 and the voltage sources in case 3 |
| Ordering (candidate B) | barycentre of neighbour index | neighbour index plus where the shared pin sits on that neighbour | fewer crossings in case 5 |
| Labels | preference list | also kept clear of pin approach points; extra outside-corner positions for chips | a label in front of a pin made case 5 unroutable |
| Default ground text | "symbol only" | render model carries text "GND" for the verifier; nothing is drawn | the verifier compares names, so the implied text must be explicit |
| Tooling (5) | pnpm, harfbuzzjs/fontkit | npm workspaces, opentype.js, DejaVu Sans | pnpm not installed; final font and shaper chosen in Phase 1 |

## Known weaknesses seen in the drawings

- Case 3: two junction dots one grid step apart at the summing node, and a small jog in V3's wire.
- Case 5: the pull-ups are stacked vertically rather than side by side; two parallel vertical wires run close together to U3. The 0b I2C template is meant to fix this.
