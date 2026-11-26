# Importing SPICE netlists

`schem` imports standard SPICE netlists (`.cir`, `.sp`, `.net`) into validated `.schem` text schematics and `LoadedProject` objects.

SPICE (Simulation Program with Integrated Circuit Emphasis) is a plain-text circuit format used by simulators such as ngspice and LTspice. The importer maps SPICE cards to `schem` built-in symbols and generic integrated circuit (IC) boxes, checks every net through `validate()`, and formats canonical `.schem` output with `formatDsl()`.

## CLI and MCP usage

### CLI

Use `schem import` to convert a SPICE file into `.schem` text (or `npm run schem -- import` from a repo clone; see [Installation and MCP setup](install.md)):

```sh
# Print canonical .schem text to stdout
schem import filter.cir

# Write a .schem file (add --overwrite to replace an existing file)
schem import filter.cir -o filter.schem
schem draw filter.schem
```

Add `--json` for machine-readable output (`{ ok, out?, dsl, warnings, parts, nets }`). Warnings about skipped directives or fallbacks are printed to stderr in plain-text mode.

### MCP

In MCP (Model Context Protocol), call `schem_import` with the destination `path` (`.schem` or `.schem.json`; must not exist yet) and the SPICE netlist text in `spice`:

```json
{
  "path": "/path/to/your/circuits/filter.schem",
  "spice": "RC Low-Pass Filter\nV1 in 0 SIN(0 1 1k)\nR1 in out 1k\nC1 out 0 100n\n.end",
  "detail": "normal"
}
```

`schem_import` parses the SPICE text, validates and lays out the circuit, saves the new project file, and returns `status`, `verified`, `revision`, `layoutToken`, `warnings`, counts and (unless `detail` is `"brief"`) the first findings.

## Syntax rules

- **Title**: The first non-empty line is read as the circuit title unless it starts with `*`, `;`, `.`, or looks like an element card. A `.title <text>` directive sets or overrides the title.
- **Comments**: Lines starting with `*` or `;` are ignored. Inline comments start at `;`.
- **Line continuations**: A line starting with `+` is joined onto the previous logical card, even across comment lines.
- **End of deck**: `.end` stops parsing. Any lines after `.end` are ignored.
- **Units and values**: SPICE prefixes (`p`, `n`, `u`, `m`, `k`, `meg`, `G`) and scientific notation (such as `1e-6` or `2.2e3`) are normalised so `schem` renders clean SI labels.

## Supported elements

See [Part types](parts.md) for the full pin list of every built-in symbol.

| SPICE card | `schem` type | Pin mapping | Notes |
| --- | --- | --- | --- |
| `R<id> n1 n2 <val>` | `resistor` | `1`, `2` | Sets `value`. |
| `C<id> n1 n2 <val>` | `capacitor` | `1`, `2` | Sets `value`. |
| `L<id> n1 n2 <val>` | `inductor` | `1`, `2` | Sets `value`. |
| `D<id> a k [model]` | `diode`, `zener`, `schottky`, `led` | `A`, `K` | Keeps `partNumber: model`. Detects Schottky (`1N58xx`, `SB*`, `SCHOTTKY`), Zener (`BZX*`, `1N47xx`, `ZENER`) and LED (`*LED*`). |
| `V<id> pos neg [spec]` | `ac-source`, `vsource`, `battery` | `1`/`2` (`ac-source`), `+`/`-` (`vsource`, `battery`) | Uses `ac-source` for `AC` or `SIN`/`SINE`, `battery` for DC sources with battery-style names (`VBAT`, `BAT*`), and `vsource` otherwise. |
| `I<id> pos neg <val>` | `current-source` | `-` (`pos`), `+` (`neg`) | Sets `value`. Maps to the built-in `current-source` symbol so the arrow points from `pos` towards `neg` (matching SPICE current direction). |
| `Q<id> c b e [sub] <model>` | `npn`, `pnp` | `C`, `B`, `E` | Sets `partNumber: model`. Optional 4th substrate node is omitted with a warning. |
| `M<id> d g s [b] <model>` | `nmos`, `pmos` | `D`, `G`, `S` | Sets `partNumber: model`. Optional 4th bulk node is silently dropped when tied to source, or warned when different. |
| `X<id> n1..nN <subckt>` | `opamp` or `ic` | `3` (`IN+`), `2` (`IN-`), `1` (`OUT`) or `1..N` | See `.subckt` rules below. |

Unsupported elements (such as behavioural or controlled sources `E`, `F`, `G`, `H`, `B`) and mutual inductance coupling (`K`) are skipped with a warning.

## `.model` rules

`.model` directives may appear before or after the elements that reference them:

- `Q` transistors check `.model <name> NPN` or `.model <name> PNP`. If no `.model` is present, common part prefixes (such as `2N2222` or `2N3906`) are recognised; unknown models default to `npn` with a warning.
- `M` MOSFETs check `.model <name> NMOS`, `.model <name> PMOS`, or `VDMOS` (`pchan`). Without a `.model`, names starting with `P` or matching common P-channel prefixes map to `pmos`, and `N` names map to `nmos`.
- `D` diodes inspect `.model` `type=...` parameters in addition to the model name.

## `.subckt` rules

- Internal cards between `.subckt <name> <pins...>` and `.ends` are not added to the top-level circuit. Nested `.subckt` blocks are tracked safely.
- When `X<id> n1..nN <subckt>` references a `.subckt` defined in the same file, pin names are copied from the `.subckt` header and roles (`power_in`, `power_out`, `ground`, `input`, `output`, `bidir`) are inferred from pin names.
- A 3-pin subcircuit maps to the built-in `opamp` symbol if its `.subckt` pins match `(in+, in-, out)` or its model name is a known op-amp (such as `LM741`, `TL072`, `OP07`, `LM358`).
- A 5-pin known op-amp without a local `.subckt` maps to a 5-pin `ic` box with pins `IN+`, `IN-`, `V+`, `V-` and `OUT`, keeping the power rail connections intact.

## Nets and directives

- Node `0` and `GND` (any case) map to net `GND` with `kind: "ground"`.
- Supply-named nodes (`VCC`, `VDD`, `5V`, `3V3`, `12V`, `-12V`, `VEE`, `VSS` and similar) keep their name and inferred `kind` (`power` or `ground`).
- Node matching is case-insensitive, following SPICE convention. Nets are emitted in deterministic canonical order: power nets first, then ground nets (`GND` first), then signal nets, with endpoints sorted naturally.
- Simulation directives (`.tran`, `.ac`, `.dc`, `.op`, `.param`, `.options`, `.plot`, `.print`, `.probe`, `.save`, `.ic`, `.nodeset`, `.include`, `.lib`, `.backanno` and `.control`..`.endc` blocks) are ignored with informational notes in `warnings`.

## Example

Input SPICE netlist:

```spice
RC Low-Pass Filter
* First-order RC low-pass filter
V1 in 0 SIN(0 1 1k) ; 1 V peak sine wave at 1 kHz
R1 in out 1k
C1 out 0 100n
.ac dec 20 10 100k
.end
```

Canonical `.schem` output (see [Text schematics](dsl.md)):

```text
circuit "RC Low-Pass Filter"

part C1 capacitor value=100n
part R1 resistor value=1k
part V1 ac-source value=1V freq=1kHz

net GND kind=ground = C1[2] V1[2]
net in = R1[1] V1[1]
net out = C1[1] R1[2]
```

## Programmatic TypeScript API (advanced)

When calling the importer directly from TypeScript (`src/io/spice.ts`):

```ts
import { importSpice } from "../src/io/spice.js";

const result = importSpice(spiceText);
if (result.ok) {
  // result.project is a validated LoadedProject ready for layout() or saveProject()
  // result.dsl is the canonical .schem text from formatDsl()
  // result.warnings lists informational notes and fallback warnings
}
```

`SpiceImportResult` has the shape `{ ok: boolean; project?: LoadedProject; dsl?: string; warnings: string[]; errors: string[] }`.
