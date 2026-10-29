# Inductor symbol

## What I did

Added an `inductor` symbol so a coil can be named in a netlist and drawn. It is a two-pin part, reference prefix `L`, pins `1` and `2`, with the same chain direction as a resistor (pin 1 in, pin 2 out). The artwork is an IEEE coil: four semicircles on one side of the lead, the same overall length as the resistor. It was drawn for this project. Nothing was copied from another symbol library.

A small LC low-pass filter in `tests/support/symbol-circuits.ts` uses it: an AC source, the inductor in series, a capacitor to ground, and a load resistor. The value `10u` is shown as `10 µH`.

The playground parts panel lists every built-in symbol, so a new inductor there gets the default value `10u`.

## Files changed

- `src/symbols/library.ts`: the symbol, and its entry in `BUILTIN`.
- `tests/support/symbol-circuits.ts`: the LC low-pass circuit.
- `docs/parts.md`: regenerated with `npm run docs:parts`. The inductor row is pins `1` and `2`.
- `README.md`: the symbol count is now 23.
- `web/main.ts`: default value `10u` when the playground adds an inductor.
- `docs/agent-reports/grok-inductor-symbol.md`: this report.

## Commands and results

- `npm run docs:parts`: wrote `docs/parts.md` (27 part types).
- `npx vitest run tests/symbols.test.ts`: 103 tests passed. The new symbol passes the loader check in all 8 orientations, and the LC filter lays out `valid`.
- `npm run draw:symbols`: `lc-low-pass` is layout `valid`, verifier `valid`, 0 overlaps, 0 crossings, 4 bends. The sheet has 22 drawn symbols (ports are left off the sheet) and includes the inductor. I opened `out/symbols/lc-low-pass.png` and `out/symbols/sheet.png`. The coil reads as four humps. The filter shows the source, the series inductor, the shunt capacitor, the load, the ground symbols, and the junction dot.
- `npm run typecheck`: passed (engine and `web`).
- `npm test`: 498 tests passed, 20 files.
- `npm run phase0`: all 8 validation cases stayed `valid`. All 12 validation edit scripts that the runner applies behaved as before (11 saved and passed gate 4; `case03-pin-sides` rejected as invalid input). Gate totals stay incomplete because this command does not run the held-out set. `case08-diffpair` is `valid` and the table shows 1 convention. No layout code changed.

## Skipped

- Did not run `npm run phase0 -- --test` or `npm run gates -- --test`.
- Did not edit `phase0/`, `tests/fixtures/`, or `SPEC.md`.
- Did not change the layout engine. SPEC 9.2 names an inductor as a power-path element (a series part that can carry a supply onward). This symbol is drawn with the ordinary two-pin rules. The LC filter does not need the power-path rule.

## Open questions

- Should a later change teach the layout that an inductor continues a power path, the way the spec describes? That belongs in `src/layout/` and needs an agreed issue first.
