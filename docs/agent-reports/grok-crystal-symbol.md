# Crystal symbol

## What I did

Added a `crystal` symbol. It is a two-pin part, reference prefix `Y`, pins `1` and `2`, with the same chain direction as a capacitor (pin 1 in, pin 2 out). The artwork is the IEEE crystal: a rectangle between two plates. It was drawn for this project.

A microcontroller clock circuit uses it. `U1` is an `ic` labelled MCU, with `XTAL1`, `XTAL2` and `GND`. A 16 MHz crystal stands between the two clock pins, and a 22 pF capacitor goes from each side to ground. An orient hint turns the crystal so pin 1 is up. Without that hint the crystal lay on its side and the return wire ran around it. The value `16MHz` is shown as `16 MHz`.

The symbol test checks that the two crystal pins share an x coordinate and that pin 1 is above pin 2.

The playground inserts a crystal with value `16MHz`.

## Files changed

- `src/symbols/library.ts`: the symbol, and its entry in `BUILTIN`.
- `tests/support/symbol-circuits.ts`: the clock circuit and the orient hint.
- `tests/symbols.test.ts`: the two checks for that circuit.
- `docs/parts.md`: regenerated with `npm run docs:parts` (27 part types).
- `README.md`: the symbol count on this branch is 23.
- `web/main.ts`: the crystal default value.
- `docs/agent-reports/grok-crystal-symbol.md`: this report.

## Commands and results

- `npm run docs:parts`: wrote `docs/parts.md` (27 part types).
- `npx vitest run tests/symbols.test.ts`: 103 tests passed.
- `npm run draw:symbols`: `mcu-crystal` is layout `valid`, verifier `valid`, 0 overlaps, 0 crossings, 4 bends. I opened `out/symbols/mcu-crystal.png` and `out/symbols/sheet.png`. The sheet shows the rectangle between two plates. In the circuit the crystal stands to the right of the MCU, the upper wire is `XTAL1` with `C1` to ground, and the lower wire is `XTAL2` with `C2` to ground.
- `npm run typecheck`: passed (engine and `web`).
- `npm test`: 498 tests passed, 20 files.
- `npm run phase0`: all 8 validation cases stayed `valid`. The 12 validation edit rows match the previous run. `case08-diffpair` is `valid` and the table shows 1 convention. No layout code changed.

## Skipped

- Did not run `npm run phase0 -- --test` or `npm run gates -- --test`.
- Did not edit `phase0/`, `tests/fixtures/`, or `SPEC.md`.
- Did not change `src/layout/`.

## Open questions

- Pull requests 2 and 3 also edit the README symbol count, from 22. This branch says 23. If the inductor, the two diodes and this crystal all land, the count should be 26.
