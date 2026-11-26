# Report: claude/cli-ux

Branch `claude/cli-ux`, made from `t3/faa7a337` at `18896c2`. Nothing was pushed, merged or rebased.

## What I did

I polished the human side of the `schem` command line. Machine output (`--json`), the MCP server and every existing test contract are unchanged.

1. **New module `src/cli-ui.ts`.** It only shapes text. It holds:
   - ANSI styling with standard codes only (bold, dim, red, green, yellow, cyan). Every style returns its text unchanged when styling is off.
   - `colorWanted(stream, argv)`: styling only when the stream is a terminal (TTY), `NO_COLOR` is not set, `TERM` is not `dumb`, and the arguments do not include `--json`, `--alt-text` or `--version`.
   - `table()` for aligned columns (widths ignore ANSI codes, no trailing spaces), `pairs()`, `fitList()` (ends with `(+N more)` instead of wrapping), `num()` (rounding without trailing zeros), `point()`, `bytes()`, `plural()`.
   - `editDistance()` and `closest()` for typo suggestions.
   - The help text: `mainHelp()` for `schem --help` and `commandHelp()` for each of the 14 commands. The MCP tool list in the help is read from `TOOLS` in `src/mcp/tools.ts`, so it cannot drift. Templates and themes come from `INIT_TEMPLATE_NAMES` and `THEME_NAMES`.
2. **`src/cli.ts`.**
   - `Io` gained three optional fields: `color`, `errColor` and `columns`. When a test calls `run(argv, io)` without them, output is plain, exactly as before.
   - New exported `processIo(argv)` builds the real stdout and stderr sinks with `colorWanted()`. The entry point and `src/bin.ts` both use it.
   - Help routing: `schem`, `schem -h`, `schem --help` and `schem help` print the grouped help. `schem <command> --help`, `schem <command> -h` and `schem help <command>` print that command's usage, options, examples and exit codes (exit 0). `schem help mcp` and `schem mcp --help` print the MCP server help. With `--json`, help is one JSON object: `{ "status": "help", "command": ..., "help": ... }`.
   - Unknown commands exit 2 with `Did you mean "draw"?` when a command is close, plus `Run "schem --help" for commands.` Unknown options get the same treatment (`--them` suggests `--theme`).
   - Usage errors now print `error: <message>`, the command's usage line and `Run "schem <command> --help" for options and examples.` They no longer dump the whole help. `--json` usage errors are unchanged.
   - `emit()` now picks a human format per command: `check`, `init`, `undo`, `render`, `preview`, `fmt`, `describe`, `components`, `component` and `query`. Exit codes are computed exactly as before.
   - `draw`, `edit`, `import` and `watch` keep their wording and gain styling on a terminal. `import -o` adds a `Next: schem draw ...` hint. `watch` prints `Watching <file> -> <dir> (Ctrl+C to stop)` before the first draw instead of after it.
   - `schem mcp` now also works from `npm run schem -- mcp`: `src/cli.ts` hands it to `main()` from `src/mcp/main.ts`. This keeps the help true for both entry points. `src/bin.ts` still starts the server itself before the CLI runs, so the installed command behaves as before.
3. **`src/bin.ts`.** It no longer appends its own MCP block to the help, because the shared help already has an "MCP Server (AI Agents)" group. Before, `src/cli.ts` and `src/bin.ts` printed different help. Now both print the same text once. The bin uses `processIo(argv)`.
4. **`tests/cli-ux.test.ts`.** 65 new tests: grouped help and its 80-column limit, the exact MCP tool list, per-command help for all 14 commands in all three forms, typo suggestions, human output of `check`, `components`, `component`, `query`, `describe`, `init`, `fmt`, `render` and `draw`, `--json` still pure JSON, styling rules (`color` on and off, `errColor`, `NO_COLOR`, `TERM=dumb`, `--json`, `--alt-text`, `--version`), only standard SGR (Select Graphic Rendition, the ANSI style codes) codes, and two spawned runs of `src/bin.ts`.

Contracts I kept on purpose:

- `function isEntryPoint(): boolean {` appears once in `src/cli.ts` (the build rewrite needs it; `npm run build` passed).
- The help still contains `Usage:` and `npm run schem -- draw examples/led.schem.json`.
- `--version` prints only the version, never styled.
- `describe --alt-text` prints one plain line, also when `color` is on.
- `describe` still prints `Alt text: <text>` (checked by `tests/integration-sprint.test.ts`).
- `draw` still prints `<name>: valid.` and the SVG and PNG paths. All `edit` phrases are unchanged.

## Files changed

- `src/cli-ui.ts` (new)
- `src/cli.ts`
- `src/bin.ts`
- `tests/cli-ux.test.ts` (new)
- `docs/agent-reports/claude-cli-ux.md` (this report)

No existing test file, `src/layout/`, `phase0/`, `tests/fixtures/`, `SPEC.md`, `package.json` or `package-lock.json` was touched. No package was added.

## Commands run and results

All run after the final code change, in this worktree.

| Command | Result |
| --- | --- |
| `npm ci` | installed (fresh worktree) |
| `npm run typecheck` | passed, no errors |
| `npm test` | 41 test files, 849 tests passed |
| `npm run phase0` | all 8 validation cases `valid` (case01 to case08). The edits table also shows `case03-pin-sides rejected (invalid_input)` with expectation `either`; that is the engine refusing `setPinSides` on a fixed symbol, and `scripts/phase0.ts` does not use the CLI. |
| `npm run build` | `wrote dist/schem.js (627 KB) and dist/fonts/` |
| `npm run pack:smoke` | `pack:smoke passed: schem-cli-0.0.2.tgz, 576.3 kB, 28 files` (all 15 steps ok) |

I did not run `npm run bench -- --check`, because nothing under `src/layout/` changed.

## What the built CLI prints

From `node dist/schem.js ...` in the repo root (piped, so no colour).

`node dist/schem.js --help` (first part):

```text
schem 0.0.2: draw a clean circuit schematic from text or JSON

Usage:
  schem <command> [file] [options]
  schem <command> --help     Options, examples and exit codes for one command

Create & Import:
  init [name]                   Start a new .schem file from a verified template
  import <file.cir>             Turn a SPICE netlist into a .schem file

Draw & Export:
  draw <file>                   Write <name>.svg and <name>.png
  watch <file>                  Draw, then redraw whenever the file changes
  render <file> -o <out>        Write one verified SVG or PNG
  preview <file> -o <out.png>   Write a PNG overview or a focused crop

Inspect & Query:
  check <file>                  Status, metrics and findings for the drawing
  describe <file>               Plain-text summary and verified alt text
  query <file> part|net <ID>    Pins, positions and connections of a part or net
  components [query]            Search built-in symbols and modules
  component <type>              Pins and docs for one part type

Edit & Format:
  edit <file> --ops <ops.json>  Apply an edit script and keep the drawing
  undo <file>                   Restore the last saved version
  fmt <file>                    Tidy a file, or convert between .schem and JSON

MCP Server (AI Agents):
  mcp [--root <folder>]...      Serve the 12 schem tools on stdin and stdout
  mcp --help                    Roots, protocol and what each tool does
    Tools: schem_create, schem_edit, schem_check, schem_preview, schem_query,
    schem_render, schem_undo, schem_describe, schem_fmt, schem_components,
    schem_component, schem_import
```

It goes on with options for every command, file formats, exit codes and examples, ending with `npm run schem -- draw examples/led.schem.json`. Every line is 80 columns or fewer.

`node dist/schem.js check examples/pico-i2c-oled.schem` (exit 0). Before, the second line was one raw JSON object with values such as `9.219544457292889`.

```text
examples/pico-i2c-oled.schem  valid
  6 parts, 6 nets. 0 errors, 0 warnings, 0 notes.

Drawing
  Sheet        83 x 41 G    Squeezed runs        0
  Wire length  145 G        Far labels           0
  Crossings    1            Min dot spacing      9.2 G
  Bends        5            Min crossing to dot  2 G
  Dots         2            Aspect error         0.42
  Jogs         0            Margin imbalance     0.58

Findings  none
```

A file with a finding (`tests/dsl-corpus/bench/differentiator.schem`):

```text
Findings (1)
  info  L-squeezedRuns
        Readability: wires of different nets squeezed onto adjacent tracks: 1 (at most 0).
        fix: setSpacing (--json shows the edit; apply it with schem edit)
```

`node dist/schem.js components --limit 10`. Modules show their name and pin count (for example `Arduino UNO R3 (44 pins)`) instead of all 44 pin names.

```text
  Type            Kind     Pins / Details
  ac-source       source   1, 2
  battery         source   +, -
  buzzer          two-pin  +, -
  capacitor       two-pin  1, 2
  crystal         two-pin  1, 2
  current-source  source   +, -
  diode           two-pin  anode, cathode
  fuse            two-pin  1, 2
  ground          port     1
  header          header   pins declared on the part

Showing 1 to 10 of 43. More: schem components --limit 10 --cursor 10
Details of one type: schem component <type>
```

`node dist/schem.js component module:ssd1306-oled-i2c`:

```text
module:ssd1306-oled-i2c  SSD1306 I2C OLED Display
  Kind        module
  Ref prefix  OLED
  Controller  no
  Docs        https://github.com/sparkfun/SparkFun_Qwiic_OLED_1.3in/blob/main/docs/assets/board_files/SparkFun_Qwiic_OLED_1.3in_Schematic.pdf
  Interfaces  i2c.scl, i2c.sda

Pins (4)
  Pin  Name  Role      Aliases / Group / Interface
  1    GND   ground
  2    VCC   power_in  aliases 3V3, VDD
  3    SDA   bidir     iface i2c.sda
  4    SCL   input     iface i2c.scl
```

`node dist/schem.js query examples/pico-i2c-oled.schem part OLED1` (before, this printed the raw JSON object):

```text
Part OLED1  type: module:ssd1306-oled-i2c  at: (66, 27)  rot: 0

Pins (4)
  Pin  Name  Role      At        Dir   Net
  1    GND   ground    (73, 35)  down  GND (n2)
  2    VCC   power_in  (77, 27)  up    3V3 (n3)
  3    SDA   bidir     (73, 27)  up    SDA (n4)
  4    SCL   input     (69, 27)  up    SCL (n5)
```

`node dist/schem.js query examples/pico-i2c-oled.schem net SDA`:

```text
Net SDA  id: n4  kind: signal  drawn: wire
  endpoints: OLED1[3], R1[2], U1[6]

Pins (3)
  Part   Pin  At        Dir
  OLED1  3    (73, 27)  up
  R1     2    (39, 16)  down
  U1     6    (21, 18)  right
```

`node dist/schem.js drw` (exit 2):

```text
error: Unknown command "drw". Did you mean "draw"?
Run "schem --help" for commands.
```

With `--json`, `check` and `query` still print the same JSON objects as before (checked by the old tests and by new ones in `tests/cli-ux.test.ts`).

I checked the styled output by calling `run()` with `color: true` and printing the escape codes: headings are bold cyan, `valid` is bold green, warnings yellow, notes and `info` cyan, labels dim. I could not open a real interactive terminal from this session, so I have not seen the colours on screen myself.

## Skipped or not done

- `npm run bench -- --check`: skipped, no layout change.
- No PNG or SVG output changed, so there were no new images to inspect. `pack:smoke` confirmed the installed `draw` output is byte-identical to the repo's.
- I did not change `src/mcp/server.ts` (not in my list of files). Its `HELP` text, shown by `schem mcp --help` and `schem help mcp`, still says `Usage: npm run mcp`, which is the clone form. An installed user would want `schem mcp`.

## Open questions

1. Should `src/mcp/server.ts` `HELP` show `schem mcp [--root <folder>]...` first and `npm run mcp` as the clone form? That needs an edit outside this task's files.
2. `docs/agent-reports/claude-npm-package.md` says `src/cli.ts` has no `mcp` command. It has one now (`npm run schem -- mcp`). Reports are historical, so I left it; tell me if `docs/install.md` should mention the new form.
3. Plain usage errors no longer print the whole help, only the command's usage line and a pointer to `--help`. No test depends on the old behaviour. Is that the wanted default?
4. `schem draw --help --json` returns help as a JSON object (`status: "help"`). Before, it was a usage error. Is that the right shape for agents?
