# Contributing to schem

Thank you for helping. schem is an early prototype, and the most useful help right now needs no knowledge of the layout engine.

## Good places to start

1. **A circuit that draws badly.** Open an issue using the [bad drawing form](.github/ISSUE_TEMPLATE/bad-drawing.md) with the `.schem` or `.schem.json` circuit file and the PNG it produced, and say what looks wrong. Real circuits that break the layout are the most valuable input this project can get.
2. **A new symbol.** See [Adding a symbol](#adding-a-symbol) below, or propose one with the [new symbol or board form](.github/ISSUE_TEMPLATE/new-symbol-or-board.md). [`docs/parts.md`](docs/parts.md) lists what exists.
3. **A board.** A dev board or breakout with its real pinout, so circuits can use it by name. See [Adding a board](#adding-a-board) or file a request with the [new symbol or board form](.github/ISSUE_TEMPLATE/new-symbol-or-board.md).
4. **An example circuit.** A small, real circuit in [`examples/`](examples/) (either `.schem` text DSL or `.schem.json`) that draws valid, with a row in [`examples/README.md`](examples/README.md).
5. **Docs and bug reports.** Anything in the README, [`docs/dsl.md`](docs/dsl.md), or [`docs/netlist-format.md`](docs/netlist-format.md) that confused you is worth fixing. For crashes, CLI/MCP issues, or verifier bugs, use the [bug report form](.github/ISSUE_TEMPLATE/bug-report.md).

Changes to the layout engine (`src/layout/`) are welcome, but please open an issue first and describe the drawing problem you want to fix. Placement and routing changes affect every circuit, and the checks below are strict. [`docs/general-layout.md`](docs/general-layout.md) explains how the general layout works, lists the open jobs, and describes the benchmark (`npm run bench`) that tells you whether a change made drawings better or worse.

## Setup

You need [Node.js](https://nodejs.org/) 22 or newer.

```sh
git clone https://github.com/2Ntlaks/schem.git
cd schem
npm install
```

You can run the CLI (command line interface) directly from source with `npm run schem -- <command>`, and the MCP (Model Context Protocol) server with `npm run mcp -- --root <folder>`.

## Verification checklist

Before you open a pull request, run and pass these core checks:

```sh
npm run typecheck   # TypeScript, no errors
npm test            # the test suite
npm run phase0      # draws the 8 development circuits; all must stay "valid"
```

Run these additional checks whenever your change touches those areas:

```sh
npm run bench -- --check  # required when touching src/layout/: no bench circuit may score worse
npm run build             # required when touching CLI, MCP, or packaging: builds dist/schem.js
npm run pack:smoke        # required when touching CLI, MCP, or packaging: tests the packed CLI and MCP binary
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

Draw symbols yourself. Do not copy artwork from other projects unless their license is compatible with MIT and you say where it came from; for example, circuitdiagram/components is GPL and cannot be copied here.

## Adding a board

A board (an Arduino, a sensor breakout, a regulator module) is a *module*: a JSON file in [`src/modules/`](src/modules/) that lists its real pins. It has no artwork; schem draws it as a labelled box. Every file in that folder is loaded and checked automatically, so adding a board needs no code.

1. Find the board's official documentation: the maker's pinout page, user guide or datasheet. Every pin number and name must come from it. Do not work from memory or from a third-party pinout picture.
2. Create `src/modules/<name>.json`, where `<name>` is the module id without `module:` (lower case, digits, `-` and `.`). Copy [`pololu-d24v10f5.json`](src/modules/pololu-d24v10f5.json) (5 pins) or [`esp32-devkitc-v4.json`](src/modules/esp32-devkitc-v4.json) (38 pins) as a starting point. The fields:
   - `id` (`"module:<name>"`), `version` (`1`), `kind` (`"module"`), `name` (the product name), `refPrefix` (`"U"` for most boards).
   - `controller`: `true` for a microcontroller board, which the layout treats as where signals start.
   - `doc`: `url` and `revision` are required and say exactly where the pins come from. Add `title`, `retrieved` (the date you read it), `pinNumbering` (how you numbered the pins if the document does not) and `notes`, like the existing boards.
   - `pins`: one entry per physical pin, each with a `number` (as printed on the board or in the document, for example `"J2-10"`), a `name`, and a `role`: `power_in`, `power_out`, `ground`, `input`, `output`, `bidir`, `passive` or `nc`. Optional: `aliases` (other names people use, such as `"GPIO26"`), `group` (pins that are the same net on the board, such as every `GND`, so a circuit can write `U1{GND}`), and `iface` (`i2c.sda`, `i2c.scl`, `spi.sck`, `spi.mosi`, `spi.miso`, `spi.ss`) when the documentation fixes a pin's role on a bus.
3. Run `npm test`. A mistake (a duplicate pin number, an unknown role, a file name that does not match the id) fails with a message naming the pin.
4. Draw a small circuit that uses the board (`.schem` or `.schem.json`) with `npm run schem -- draw <file>` and open the PNG.
5. Run `npm run docs:parts` and commit the updated [`docs/parts.md`](docs/parts.md) with your file.

In the pull request, link the documentation you used. A reviewer checks the pins against it.

## Pull requests

- Keep each pull request to one topic and fill out the [pull request template](.github/PULL_REQUEST_TEMPLATE.md).
- Say what you checked: the verification commands above, and which drawings you looked at.
- For anything that changes a drawing, attach before and after PNGs.
- Write docs and messages in plain English with short sentences. Do not use em dashes or en dashes; use a hyphen, a colon or a full stop.

## Using an AI coding agent

You are welcome to use one. [`AGENTS.md`](AGENTS.md) holds the rules for coding agents in this repo (most agents read it automatically); point your agent at it and at the issue you are working on. You are responsible for what the agent submits: read the diff and look at the drawings before you open the pull request.

## License

By contributing, you agree that your contribution is licensed under the [MIT license](LICENSE), like the rest of the project.
