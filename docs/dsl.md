# Text schematics

A text schematic, or domain-specific language (DSL) file, lists parts and connections in a `.schem` file. The compiler turns it into the same circuit and drawing instructions used for JSON. Use the drawing check after writing or editing a circuit.

## LED example

```text
circuit "LED with a current-limiting resistor"
style theme=clean

part B1 battery 9V
part R1 resistor 470
part D1 led color=red

net PWR = B1.+ R1.1
connect R1.2 D1.anode
net GND = D1.cathode B1.-
```

This circuit has the same drawing as the JSON example. [Text file](../examples/led.schem) and [JSON file](../examples/led.schem.json).

```sh
npm run --silent schem -- check examples/led.schem --json
npm run schem -- render examples/led.schem -o led.svg
```

## Summing amplifier example

Three input resistors feed the inverting pin of `U1`. The feedback resistor `Rf` connects the output to the same junction. This example uses pin numbers so it can be compared directly with the validation circuit.

```text
circuit "Case 3: inverting summing amplifier"

part V1 vsource 1V
part V2 vsource 0.5V
part V3 vsource 0.2V
part R1 resistor 10k
part R2 resistor 10k
part R3 resistor 10k
part Rf resistor 20k
part RL resistor 2k2
part U1 opamp

connect V1[+] R1[1]
connect V2[+] R2[1]
connect V3[+] R3[1]
net SUM = R1[2] R2[2] R3[2] Rf[1] U1[2]
net OUT = RL[1] Rf[2] U1[1]
net GND = RL[2] U1[3] V1[-] V2[-] V3[-]
```

## Source and pin spelling

- Use UTF-8. A byte order mark at the start is optional. Unix and Windows line endings work. A final newline is optional.
- Write one statement per line. A backslash at the end of the line continues the statement. Blank lines are allowed.
- Outside a quoted string, `#` at the start of a line or after whitespace starts a comment. Inside a string, `#` is text. Use `\"` for a quote and `\\` for a backslash. Write options as `key=value` and quote a value that contains spaces.
- Keywords and identifiers are case-sensitive. A part ID starts with a letter and can contain letters, digits and underscores. Part types include `resistor`, `ic`, `header` and shipped module names such as `module:esp32-devkitc-v4`.
- Use `U1[21]` for a numbered pin, `U1.GPIO21` for a pin name or alias, and `U1{gnd}` for an internal group. A name that matches several pins can select the group if every match is in that group. Use pin numbers to resolve other ambiguous names. List available types with `npm run schem -- components` and inspect one type's pins with `npm run schem -- component <type>`. [Part and pin reference](parts.md).
- Put inline pins on an IC or header after `pins:`. Each pin uses `[NUMBER:]NAME[/ROLE][@GROUP]`. For example, `part U1 ic "Controller" pins: 14:GND/ground@gnd 21:SDA/bidir`. Defaults are sequence numbers starting at 1 and a role inferred from the name. Common supply names become `power_in`, common ground names become `ground`, and the rest become `bidir`. Other roles are `power_out`, `input`, `output`, `passive` and `nc`.

## Statements

| Statement | Effect |
| --- | --- |
| `circuit "LED indicator"` | Set the circuit title. |
| `style theme=clean symbols=ieee` | Store sheet style options. See [Rendering themes](themes.md). |
| `part R1 resistor 4.7k` | Declare a part. The first bare or quoted value is its `value`. Other properties use options such as `color=red` or `label="Front panel"`. |
| `net GND kind=ground domain=analog = U1{gnd} C1[2]` | Declare or extend a named net. `kind` accepts `signal`, `power` or `ground`. With no kind, the name supplies the default. |
| `connect R1[2] D1.anode` | Join two or more endpoints. If they touch existing nets, the usual merge rules apply. |
| `chain B1[+] -> R1 -> D1 -> B1[-]` | Join neighbouring links. A bare two-pin symbol must declare chain input and output pins. A bare part at either end leaves the outer pin open and produces a warning. |
| `nc U1[11] U1[12]` | Mark one or more numbered terminals as intentionally unconnected. |
| `hint D1 right-of R1` | Give a relative placement hint. The relations are `right-of`, `left-of`, `above` and `below`. |
| `hint row R1 R2 R3` | Align the listed parts on a row. Use `column` for equal horizontal positions. |
| `hint R1 vertical` | Request rotation 90. `horizontal` requests rotation 0. Both use no mirror. |
| `hint near C1 U1` | Store a proximity hint. JSON uses `schem/1.1` for this hint. The current layout engine has no proximity behavior for it. |
| `hint C1 decouples U1.VCC` | Assign a capacitor to another part's supply pin. |
| `hint U1 pins-left IN pins-right U1[9]` | Assign pin sides and order on a chip, header or module. `pins-top` and `pins-bottom` also work. |
| `hint strict R1 above R2` | Make the hint a requirement. `hint R1 above R2 priority=high` raises its priority. The ordinary priority is `normal`. Use `strict` by itself. |
| `lock U1 at 20,10 rotate 90 flip` | Fix a part at grid coordinates. Rotation defaults to 0 and accepts 0, 90, 180 or 270. `flip` mirrors the part and is optional. |
| `override R1 label-side=below` | Write the part's label on the given side. Also accepts `above`, `left` and `right`. |
| `override net SDA at U1[21] style=label` | Store a net presentation preference. Styles are `wire`, `port` and `label`. Omit `at` to target the whole named net. The current layout engine preserves this preference in the file. |

A terminal belongs to only one net. `connect` and `chain` refuse merges that join power to ground, join different domains, or combine distinct named nets that need an explicit decision. Use the JSON `mergeNets` edit for an explicit merge. New net IDs follow canonical endpoint order, so reordering declarations and using a different spelling for the same endpoint preserve the drawing. Hints keep their written order. [Netlist and merge rules](netlist-format.md).

### Not yet supported

`hint input J1` and `hint output SPK1` are flow hints. `group "Power supply" U1 C1 C2` is a group hint. The compiler recognises these statements and returns `E260`.

## CLI commands, formatting, edits and exports

Run commands with `schem <command>` after installing (see [Installation and MCP setup](install.md)), or with `npm run schem -- <command>` from a repo clone.

| Command | Result |
| --- | --- |
| `init [name] [--template <name>]` | Create a valid starter circuit. Templates: `led` (default), `divider`, `opamp`, `regulator`, `i2c`, `bjt-amp`. The default file is `circuit.schem`. End the name in `.json` for a JSON starter. |
| `check <file> [--detail brief\|normal\|full] [--cursor N]` | Report drawing status, metrics and findings. `--detail brief` prints counts and tokens only; `--cursor N` fetches the next page of findings. |
| `render <file> -o <output.svg\|png> [--scale N \| --dpi N] [--theme <name>] [--transparent] [--draft] [--overwrite]` | Export a verified drawing. `--theme <name>` (`clean`, `dark`, `blueprint`, `textbook`, `mono-print`) sets the palette and `--transparent` omits the background ([Rendering themes](themes.md)). For PNG use `--scale N` in pixels per grid unit or `--dpi N`. `--draft` allows an available low-confidence drawing. `--overwrite` replaces an existing export. |
| `preview <file> -o <output.png> [--max N] [--focus R1,U2 \| --finding ID]` | Export a PNG up to 1024 pixels on its longest side by default. Use `--max N` to change the cap. Use `--focus R1,U2` to crop to parts or `--finding ID` to focus on a finding from `check`. |
| `query <file> part\|net ID` | Show locations, pins and connections. A net can be selected by ID or name. |
| `describe <file> [--table] [--alt-text]` | Read the sheet size, parts, neighbours, connections and verified alt text. `--table` adds a net table. `--alt-text` prints only the verified alt-text line. |
| `components [query] [--limit 20] [--cursor N]` | Search the symbol and module catalogue. Use the returned cursor to fetch another page. |
| `component <type>` | Show full pin numbers, names, aliases, roles, groups, interfaces and module metadata for one symbol, `ic`, `header` or `module:*` type. |
| `import <file.cir> [-o <output.schem>] [--overwrite]` | Import a SPICE netlist (`.cir`, `.sp`, `.net`) into canonical `.schem` text. Prints to stdout unless `-o` is given. See [SPICE import](spice-import.md). |
| `edit <file> --ops <ops.json> [-o <dir>] [--strict] [--dry-run] [--expect-revision <R>] [--expect-layout <L>]` | Apply an edit script transactionally. `--dry-run` checks without saving. `--strict` refuses edits that move untouched parts beyond the stability limit. [Edit operations](editing.md). |
| `undo <file>` | Restore the latest saved version from the project's history. |
| `fmt <file> [--to dsl\|json]` | Format a file in place. `--to dsl` and `--to json` write a new sibling when changing formats. Existing siblings are protected. |
| `draw <file> [-o <dir>] [--theme <name>] [--transparent]` | Write both SVG and PNG to `<dir>` (default `out`). Supports `--theme <name>` and `--transparent`. |
| `watch <file> [-o <dir>] [--theme <name>] [--transparent]` | Draw once, then redraw SVG and PNG whenever `<file>` changes. |

The commands with a circuit path accept `.schem` or JSON. Use `npm run --silent schem -- <command> --json` for a JSON response without the npm banner. Exit status `0` means success, `1` means invalid input or drawing, `2` means usage, `3` means an internal error, and `4` means a write lock or revision conflict. The older plain-text `draw` and `edit` forms retain exit `2` for unreadable JSON input.

A text edit may reformat declarations and remove ordinary comments. The previous file is kept in `.schem-history`. A saved text file may end with a `# schem-layout:` comment. That comment lets the CLI reuse the verified placement and routing while the circuit and hints still match. It can be removed to draw afresh. Use the returned `revision` and `layoutToken` with `--expect-revision` and `--expect-layout` when applying edits based on a previous result.

Conversion to text reports the fields it would lose. Unsupported fields include creation dates, extension metadata, nonstandard asset definitions, saved JSON layout caches, inline pin aliases or interface roles, and overrides on unnamed nets. The compiler regenerates the net and hint counters. Through MCP (Model Context Protocol; see [Installation and MCP setup](install.md)), pass `.schem` text directly as `source` to `schem_create`, or pass SPICE netlist text to `schem_import` to create a laid-out `.schem` or `.schem.json` file in one step.

## Diagnostics

Text diagnostics show a code, a one-based `line:column-line:column` span, and a message. The end column follows the final character in the span.

```text
E104 2:9-2:13 unknown pin "R1.3". R1 (resistor) has pins 1, 2.
```

| Code | Meaning |
| --- | --- |
| `E101`, `E102` | Syntax error or invalid project field. |
| `E104` | An endpoint does not identify a pin or the pin is absent from the selected net. |
| `E106` | A name matches several pins with no shared group. Use the listed terminal numbers. |
| `E201`, `E202`, `E203` | Unknown part type, unknown module, or invalid inline pin declaration. A close match may be suggested. |
| `E206` | A bare part in a chain needs an explicit pin. |
| `E220`, `E222` | A pin or internal pin group would belong to two nets. The message names the nets and their source lines. |
| `E223`, `E224`, `E225` | A terminal marked `nc` is in a net, `nc` refers to a group, or every terminal of a connected group is marked `nc`. |
| `E230`, `E231`, `E232`, `E233` | A merge would join incompatible kinds, domains or names, or needs a named survivor. |
| `E240`, `E241` | Conflicting declarations for a net name, or an absent or empty net. |
| `E250`, `E251` | Duplicate part ID or a reference to an unknown part. |
| `E260`, `E261`, `E262`, `E263` | Unsupported or invalid hint, invalid decoupling target, or contradictory strict hints. |
| `E270` | A pin-side hint uses a fixed symbol or repeats a pin. |
| `E310`, `E311` | Decimal comma or wrong unit in a quantity. Use a decimal point as in `4.7k`. |
| `W263` | A decoupling capacitor has unexpected connectivity. |
| `W320` | A quantity remained in its original spelling because it could not be interpreted. |
| `W410` | A net has one endpoint. Connect it or mark the terminal `nc`. |
| `W411` | A bare part at the end of a chain leaves its outer pin open. |
