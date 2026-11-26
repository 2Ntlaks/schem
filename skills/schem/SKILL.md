---
name: schem
description: Draw and edit verified electronic schematics from text DSL (.schem) or JSON netlists using the schem MCP server or CLI.
---

# schem: verified schematic drawing

`schem` turns a circuit netlist into a clean, verified SVG or PNG schematic.

## Core rules

- **Files are the state.** Every command operates on a `.schem` or `.schem.json` file path.
- **Never invent coordinates.** Let the layout engine place parts and route wires. Only add hints or locks to fix specific findings.
- **Never change the circuit just to improve the drawing.** Do not remove parts, change values, swap pins or alter nets to avoid a crossing or warning.
- **Prefer `.schem` text DSL over JSON** when creating a new circuit. It is shorter and easier to review.
- **Stay inside configured roots.** Pass absolute paths when calling MCP tools.

## MCP workflow (11 tools)

Follow this loop in order:

1. **Discover parts:** Call `schem_components` (with optional `query`, `limit`, `cursor`) to search built-in symbols and modules. Call `schem_component` with `type` to read full pin numbers, names, aliases, roles, groups, interfaces, `refPrefix` and module docs before wiring pins.
2. **Create:** Call `schem_create` with `path` (ending in `.schem` or `.schem.json`) and `source` (`.schem` text DSL preferred, or JSON text/object). The file must not exist yet.
3. **Check:** Call `schem_check` to read `status`, `revision`, `layoutToken`, `counts` and findings (5 per page; pass `cursor` for more). A finding may carry a checked `fix`.
4. **Edit:** Call `schem_edit` with `ops` from a checked fix or a visual adjustment (`place`, `setOrientation`, `align`, `setPinSides`, `setLabelSide`, `setNetStyle`, `setSpacing`, `lock`, `relayout`). Always pass `expectedLayout` from a finding's fix, and `expectedRevision` when you have it. Use `dryRun: true` to test without saving.
5. **Undo if needed:** Call `schem_undo` to restore the latest snapshot from `.schem-history` if an edit makes the sheet worse.
6. **Inspect:** Call `schem_preview` once at the end to check the PNG visually. If labels would be under 9 px, the tool returns an overview and a note: call `schem_preview` again with `focus` (part ids) or `finding` (finding id) to crop in. Use `schem_query` for exact part/pin/net coordinates, and `schem_describe` (optionally `table: true`) for a plain-text sheet summary and net table.
7. **Render and format:** Call `schem_render` with `format: "svg"` or `"png"` and `out` (`scale` or `dpi` for PNG, never both; `overwrite: true` to replace). Use `schem_fmt` to format in place or convert (`to: "dsl"` or `"json"`).

## Stopping rule

Repeat `schem_check` and `schem_edit` until any of these holds:

- `status` is `valid` and the warning count is `0`.
- Two consecutive rounds make no progress.
- Five rounds have passed.

Visual operations are setters (repeating one changes nothing). `addPart` fails if the part id already exists. A stale `expectedRevision` or `expectedLayout` returns `status: "conflict"` and writes nothing: re-run `schem_check` for fresh tokens.

## CLI workflow (without MCP)

All commands accept `.schem` or `.schem.json` and `--json` for machine output:

```sh
schem components [query] [--limit 20]
schem component <type>
schem init [name]
schem check <file> [--detail brief|normal|full] [--cursor N]
schem edit <file> --ops ops.json [--expect-revision R] [--expect-layout L] [--dry-run] [--strict]
schem undo <file>
schem preview <file> -o preview.png [--max 1024] [--focus R1,U2 | --finding ID]
schem query <file> part R1
schem query <file> net GND
schem describe <file> [--table]
schem fmt <file> [--to dsl|json]
schem render <file> -o out.svg [--overwrite]
schem render <file> -o out.png --dpi 300 [--overwrite]
```

Exit codes: `0` valid, `1` invalid or input error, `2` usage, `3` internal error, `4` lock or revision conflict.

## `.schem` quick syntax cheat sheet

One statement per line (`\` continues a line; `#` starts a comment outside quotes).

```text
circuit "LED indicator"
style theme=clean

part B1 battery 9V
part R1 resistor 470
part D1 led color=red
part U1 ic "Sensor" pins: 1:VCC/power_in 2:GND/ground@gnd 3:SDA/bidir 4:SCL/bidir

net PWR = B1.+ R1.1
connect R1.2 D1.anode
net GND = D1.cathode B1.-
chain B1[+] -> R1 -> D1 -> B1[-]
nc U1[4]

hint D1 right-of R1
hint row R1 D1
hint R1 vertical
hint C1 decouples U1.VCC
hint U1 pins-left VCC GND pins-right SDA SCL
override R1 label-side=below
```

Pin spellings:
- `U1[21]`: numbered terminal
- `U1.SDA`: pin name or alias
- `U1{GND}`: internal pin group on a module or IC

Inline pins syntax: `[NUMBER:]NAME[/ROLE][@GROUP]`. Roles: `power_in`, `power_out`, `ground`, `input`, `output`, `bidir`, `passive`, `nc`.
Common built-in types: `resistor`, `capacitor`, `polarised-capacitor`, `inductor`, `diode`, `led`, `zener`, `schottky`, `battery`, `vsource`, `ac-source`, `ground`, `supply`, `opamp`, `npn`, `pnp`, `nmos`, `pmos`, `potentiometer`, `pushbutton`, `spst`, `relay`, `fuse`, `crystal`, `buzzer`, `motor`, `ic`, `header`, and `module:*` boards.
