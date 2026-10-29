# Zener and Schottky symbols

## What I did

Added `zener` and `schottky` symbols. Both are the diode body: pins `A` (anode, aliases `a`, `+`) and `K` (cathode, aliases `k`, `-`), reference prefix `D`, anode in and cathode out on a chain. Only the cathode bar differs.

- Zener: the bar ends are bent opposite ways, so the bar reads as a Z. The upper end bends back toward the anode. The lower end bends away.
- Schottky: the bar is a squared S. The upper hook turns back toward the anode. The lower hook turns out toward the cathode lead.

A Zener shunt regulator in `tests/support/symbol-circuits.ts` uses both. A 9 V battery feeds a 220 ohm resistor. A 5.1 V Zener goes from that node to ground, cathode up. A 1N5817 Schottky then feeds a 1 kohm load. The symbol test checks that the Zener cathode is above its anode, and that the Schottky anode is to the left of its cathode.

The playground inserts a Zener with value `5.1V`.

## Files changed

- `src/symbols/library.ts`: the two symbols, and their entries in `BUILTIN`.
- `tests/support/symbol-circuits.ts`: the shunt regulator.
- `tests/symbols.test.ts`: the two orientation checks for that circuit.
- `docs/parts.md`: regenerated with `npm run docs:parts` (28 part types).
- `README.md`: the symbol count on this branch is 24.
- `web/main.ts`: the Zener default value.
- `docs/agent-reports/grok-zener-schottky.md`: this report.

## Commands and results

- `npm run docs:parts`: wrote `docs/parts.md` (28 part types).
- `npx vitest run tests/symbols.test.ts`: 104 tests passed.
- `npm run draw:symbols`: `zener-shunt` is layout `valid`, verifier `valid`, 0 overlaps, 0 crossings, 2 bends. I opened `out/symbols/zener-shunt.png` and `out/symbols/sheet.png`, and a close view of each new symbol. The Zener wings and the Schottky S are visible in the circuit, not only on the sheet. The shunt shows the series resistor, the Zener to ground, the Schottky feeding the load, the junction dot, and both grounds.
- `npm run typecheck`: passed (engine and `web`).
- `npm test`: 499 tests passed, 20 files.
- `npm run phase0`: all 8 validation cases stayed `valid`. The 12 validation edit rows match the previous run. `case08-diffpair` is `valid` and the table shows 1 convention. No layout code changed.

## Skipped

- Did not run `npm run phase0 -- --test` or `npm run gates -- --test`.
- Did not edit `phase0/`, `tests/fixtures/`, or `SPEC.md`.
- Did not change `src/layout/`. The bridge and flyback templates still match type `diode` only. A Zener or Schottky is not pulled into those templates.

## Open questions

- Pull request 2 also edits the README symbol count (22 to 23). This branch says 24, counted from `main` without the inductor. If both land, the count should be 25.
- The spec lists an inductor, and a diode, as power-path elements. These two symbols use the ordinary two-pin rules, same as `diode` today.
