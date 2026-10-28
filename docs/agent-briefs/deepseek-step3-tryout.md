# Brief: one-command try-out (step 3 of the open-source plan)

For: DeepSeek V4.1 Flash in opencode. Read `AGENTS.md` first; its rules apply throughout.
Branch: `deepseek/step3-tryout` (create it from `main`).

## Goal

A newcomer clones the repo and, after `npm install`, draws a circuit with one command:

```
npm run schem -- draw examples/led.schem.json
```

and gets `out/led.svg` and `out/led.png`, plus a short, plain message saying whether the drawing is valid. When the input is wrong (missing file, bad JSON, unknown part type, a pin that does not exist), the message says what is wrong and where, in words a newcomer understands. There are a few example circuits to try, and a document that explains the input format.

Publishing to npm (so that `npx schem` works without a clone) is **not** part of this task.

## What already exists (read these, do not change them)

- `src/io/project.ts`: `readProject(path)` loads a project file and returns `{ ok, project, pinDefs, errors, warnings, missingTypes }`. It accepts the official form (`"schema": "schem/1.0"`, endpoints like `B1[+]`) and an older short form; the examples use the official form only.
- `src/layout/layout.ts`: `layout(project)` returns `{ status, render, pinDefs, notes, issues }`.
- `src/quality/index.ts`: `checkDrawing(circuit, pinDefs, render)` returns the verifier result, overlaps and metrics.
- `src/render/svg.ts` `toSvg(render)` and `src/render/png.ts` `toPng(svg)`.
- `scripts/draw.ts`: the developer script that does all of the above for `cases/`. Use it as the model for the order of calls and for which results count as invalid. Do not change it.
- `src/symbols/library.ts` (`BUILTIN`) and `src/modules/` (`MODULE_LIBRARY`): the part types and their pin names.

## What to build

### 1. `src/cli.ts` (new file; the only file under `src/` you may create or edit)

- Export `run(argv: string[], io: { out: (s: string) => void; err: (s: string) => void }): number` that returns the exit code, so tests can call it without spawning a process. The bottom of the file calls it with `process.argv.slice(2)` and sets `process.exitCode`.
- Commands:
  - `draw <file> [-o <dir>]`: load, lay out, check, write `<dir>/<name>.svg` and `<dir>/<name>.png`. `<dir>` defaults to `out`; create it if missing. `<name>` is the file name without `.schem.json` or `.json`.
  - `--help` / `-h` / no arguments: usage text with one example.
  - `--version`: the version from `package.json`.
- Exit codes: `0` drawn and valid; `1` drawn but the drawing is not valid (verifier errors or overlaps; still write the files, so the user can look); `2` nothing drawn (bad arguments, missing file, bad JSON, load errors, layout failed).
- Messages:
  - Success: one line, e.g. `led: valid. Wrote out/led.svg and out/led.png (120 ms)`.
  - Drawn but invalid: that line with `NOT valid`, then each problem on its own line (verifier errors, overlaps), like `scripts/draw.ts` prints them.
  - Missing file: `Cannot read examples/x.json: no such file`.
  - Bad JSON: the file name and the line and column of the syntax error (work them out from the parser's position; do not just print the raw exception).
  - Load errors: each error's message from `readProject`. Unknown part types come back in `missingTypes` (check whether `ok` is still true then; treat them as errors either way). For an unknown part type, also say how to see the known types (`docs/parts.md`).
  - Never print a stack trace for a user mistake. A real crash (a bug in the engine) may print one, after the line `Internal error, please report it:`.

### 2. `package.json`

Add `"schem": "tsx src/cli.ts"` and `"docs:parts": "tsx scripts/parts-doc.ts"` to `scripts`. No new dependencies, no `bin` entry.

### 3. `examples/` (new folder)

Five circuits in the official form, named `<name>.schem.json`:

| File | From (read only) |
|---|---|
| `led.schem.json` | `phase0/cases/validation/case01-led.json` |
| `summing-amp.schem.json` | `phase0/cases/validation/case03-*.json` |
| `h-bridge.schem.json` | `phase0/cases/validation/case04-*.json` |
| `i2c-sensors.schem.json` | `phase0/cases/validation/case05-*.json` |
| `esp32-relay.schem.json` | `phase0/cases/validation/case06-*.json` |

Make each one by loading the validation case with `readProject` and writing it with `saveProject` (a throwaway script outside the repo or deleted afterwards), so the content is correct by construction. Then:

- Give each a plain `meta.title` (e.g. "LED with a current-limiting resistor"), not "Case N".
- Remove fields that only repeat defaults, **only if** the file still loads with no errors and no warnings and draws exactly the same SVG as before the removal (compare the SVG text). Candidates: empty `nc`, `intent` with only default values, `assets`, empty `ext`, `meta.nextNetId`, `meta.nextHintId`. Keep `schema`. Record in your report which fields you removed and that the SVGs matched.
- `npm run schem -- draw examples/<file>` must exit `0` for all five.

Also write `examples/README.md`: one line per example (what circuit it is, what it shows off), and the command to draw it.

### 4. `scripts/parts-doc.ts` and `docs/parts.md`

`scripts/parts-doc.ts` writes `docs/parts.md`, generated from `BUILTIN` and `MODULE_LIBRARY` (never typed by hand): one table row per part type with its pin names (as written in endpoints) and, for modules, the module name. Header line: `Generated by npm run docs:parts. Do not edit by hand.` Sort the rows.

### 5. `docs/netlist-format.md`

How to write a circuit file by hand, for a newcomer: the top-level fields (`schema`, `meta`, `circuit`), a part (`id`, `type`, `props`), a net (`id`, optional `name`, `endpoints` like `R1[1]`), how power and ground nets are recognised by name, and a short note that `intent` (hints, locks) exists and is described in `SPEC.md`. Use `examples/led.schem.json` as the worked example, quoted in full.

Every field and rule you write must be one you checked in `src/io/project.ts`, `src/core/model.ts` or `src/core/validate.ts`. Put the file and function you checked in an HTML comment after each section (e.g. `<!-- checked: src/core/validate.ts validate() -->`), so the lead can verify it. If you are not sure about a rule, leave it out and list it under open questions.

### 6. Tests: `tests/cli.test.ts` (new)

Call `run()` directly with a temporary output folder (`os.tmpdir()`), and check:

- each of the five examples returns `0` and writes a non-empty SVG and PNG;
- `--help` returns `0` and prints usage; `--version` prints the `package.json` version;
- a missing file returns `2` and names the file;
- a file with a JSON syntax error on a known line returns `2` and the message contains that line number;
- a file with an unknown part type returns `2` and the message names the type and `docs/parts.md`;
- a net endpoint naming a pin that does not exist returns `2` and the message names the endpoint;
- no output for any of these contains `    at ` (a stack trace).

Write the bad inputs in the test itself (temporary files), not in `tests/fixtures/` or `examples/`.

## Checks before you report

- `npm run typecheck`, `npm test`, `npm run phase0` (all 8 validation cases still `valid`).
- Run each of the five example commands yourself and open every PNG.
- Run `npm run docs:parts` twice; the second run must not change `docs/parts.md` (`git diff --exit-code`).
- Try at least three wrong inputs by hand and paste the exact messages into the report.

## Done means

From a fresh clone: `npm install`, then `npm run schem -- draw examples/led.schem.json` writes a valid drawing and says so in one line. All five examples draw valid. Wrong input gets a clear message and exit code `2`, never a stack trace. `docs/netlist-format.md` and `docs/parts.md` exist and are accurate. Report written to `docs/agent-reports/deepseek-step3-tryout.md`, then stop.
