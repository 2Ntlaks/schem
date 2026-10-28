# Contributing to schem

Thank you for helping. schem is an early prototype, and the most useful help right now needs no knowledge of the layout engine.

## Good places to start

1. **A circuit that draws badly.** Open an issue with the circuit file and the PNG it produced, and say what looks wrong. Real circuits that break the layout are the most valuable input this project can get.
2. **A new symbol.** See [Adding a symbol](#adding-a-symbol) below. [`docs/parts.md`](docs/parts.md) lists what exists.
3. **An example circuit.** A small, real circuit in [`examples/`](examples/) that draws valid, with a line in [`examples/README.md`](examples/README.md).
4. **Docs.** Anything in the README or [`docs/netlist-format.md`](docs/netlist-format.md) that confused you is worth fixing.

Board modules (a new dev board or breakout with its real pinout) are wanted too, but the module library cannot take new boards yet: it is tied to the four boards the development circuits use. Opening it up is the next planned change; until then, please open an issue for the board you want.

Changes to the layout engine (`src/layout/`) are welcome, but please open an issue first and describe the drawing problem you want to fix. Placement and routing changes affect every circuit, and the checks below are strict.

## Setup

You need [Node.js](https://nodejs.org/) 22 or newer.

```
git clone https://github.com/2Ntlaks/schem.git
cd schem
npm install
```

Before you open a pull request, all three of these must pass:

```
npm run typecheck   # TypeScript, no errors
npm test            # the test suite
npm run phase0      # draws the 8 development circuits; all must stay "valid"
```

`npm run phase0` writes its drawings to `out/phase0/validation/`. Open them: a drawing the checks call valid can still look wrong.

## Rules that keep the results honest

The project measures its own quality against fixed circuits, so a few folders have special rules.

- **Do not look at the held-out test set.** `phase0/cases/test/`, `phase0/cases/edits/case11-*`, `baselines/LOG-test.md`, `baselines/out/*/test/` and `baselines/out/_netlist/test/` are kept unseen until the final evaluation. If you tune the engine while looking at them, the evaluation no longer means anything. Never run `npm run gates -- --test` or `npm run phase0 -- --test`.
- **Do not edit `phase0/`.** These circuits are frozen and checked against a SHA-256 manifest.
- **Do not edit `tests/fixtures/`.** They were written from the spec, independently of the code.
- **Never change a test to make your change pass.** If a test fails and you believe the test is wrong, say so in the pull request and explain why.
- **Keep output deterministic.** The same input must give the same SVG, byte for byte, on every machine. No randomness, no timestamps in the output, no reliance on system fonts. CI checks this on Windows and Linux.
- **No new dependencies** without discussing it in an issue first.

If a layout change is meant to change the drawings, `tests/snapshots/findings.json` will fail. Regenerate it with `npx tsx scripts/findings-snapshot.ts` and say in the pull request which drawings changed and why, with before and after images.

## Adding a symbol

Symbols live in [`src/symbols/library.ts`](src/symbols/library.ts). Each one is a `SymbolDef`: its pins (number, name, position, direction, electrical role), its graphics as SVG path data in grid units, and its art box. Look at `RESISTOR` and `DIODE` as small examples.

1. Draw the symbol in the same style as the others: thin strokes, standard IEEE/IEC shape, pins on whole grid points.
2. Add it to the `BUILTIN` list at the bottom of the file.
3. Add a small real circuit that uses it to [`tests/support/symbol-circuits.ts`](tests/support/symbol-circuits.ts), so it is drawn and checked in context.
4. Run `npm test`. Every symbol in `BUILTIN` is checked automatically in all 8 orientations: each pin on a whole grid point and on the edge of the symbol's keep-out box, with the wire leaving it outward.
5. Run `npm run draw:symbols` and open `out/symbols/sheet.png` and your circuit's PNG in `out/symbols/`.
6. Run `npm run docs:parts` to update [`docs/parts.md`](docs/parts.md), and commit that file too.

Draw symbols yourself. Do not copy artwork from other projects unless their licence is compatible with MIT and you say where it came from; for example, circuitdiagram/components is GPL and cannot be copied here.

## Pull requests

- Keep each pull request to one topic.
- Say what you checked: the three commands above, and which drawings you looked at.
- For anything that changes a drawing, attach before and after PNGs.
- Write docs and messages in plain English with short sentences. Do not use em dashes or en dashes; use a hyphen, a colon or a full stop.

## Using an AI coding agent

You are welcome to use one. [`AGENTS.md`](AGENTS.md) holds the rules for coding agents in this repo (most agents read it automatically); point your agent at it and at the issue you are working on. You are responsible for what the agent submits: read the diff and look at the drawings before you open the pull request.

## Licence

By contributing, you agree that your contribution is licensed under the [MIT licence](LICENSE), like the rest of the project.
