# tscircuit baseline, Part A

Branch: `deepseek/tscircuit-baseline`, created from `main` at `c5f274c`. One commit, `c4a75f9`.
Nothing was pushed or merged.

Part A only: headless setup, the converter, the schematic-level connection check, the tool-wide
settings chosen on two neutral circuits, and attempt 1 on validation cases 1 and 3. No `final.png`
was copied and no other case was run.

## Versions and where they are installed

tscircuit is installed outside the repo, in `C:\Users\ntlak\schem-baselines\tscircuit` (the
`SCHEM_BASELINES` default is `$HOME/schem-baselines`). Nothing was added to the repo's
`package.json`. All versions were installed with `--save-exact`.

| Package | Version | Why it is there |
|---|---|---|
| `@tscircuit/core` | 0.0.2229 | builds the circuit and lays out the schematic |
| `circuit-to-svg` | 0.0.454 | circuit JSON to schematic SVG |
| `tscircuit` | 0.0.3035 | meta-package; satisfies undeclared transitive imports |
| `circuit-json` | 0.0.537 | types and error shapes both packages import |
| `@tscircuit/soup-util` | 0.0.41 | undeclared transitive import |
| `@tscircuit/infer-cable-insertion-point` | 0.0.5 | undeclared transitive import |
| `format-si-unit` | 0.0.14 | undeclared transitive import |

Node 24.14.0, npm 11.9.0 (the same as the other baselines). No browser, account or API key was
needed and none was used.

The three undeclared imports and a `circuit-json` version mismatch between `@tscircuit/core` and
`@tscircuit/checks` make a bare install fail at import time; installing the versions above at the
top level is what makes the headless import work. This is recorded in `baselines/VERSIONS.md`.

## API calls used, checked against the installed types

I read the installed `dist/index.d.ts` of `@tscircuit/core` and `@tscircuit/props` and the current
docs before writing code. The calls that work in these versions are:

```js
const { Circuit, Board, Resistor, Capacitor, Inductor, Diode, Led, Battery, VoltageSource,
        Transistor, Mosfet, OpAmp, Crystal, Chip, Trace, Net } = core;
const { convertCircuitJsonToSchematicSvg } = circuitToSvg;

const circuit = new Circuit();
circuit.add(new Board({ width: "200mm", height: "150mm" }));
board.add(new Resistor({ name: "R1", resistance: "470", schOrientation: "horizontal" }));
board.add(new Trace({ name: "SUM", from: "R1.pin2", to: "U1.pin2" }));
board.add(new Net({ name: "GND", connectsTo: ["B1.pin2"], isGroundNet: true }));
board.add(new Chip({ name: "U1", manufacturerPartNumber: "ATtiny85",
  pinLabels: { pin8: "VCC", pin5: "PB0", pin4: "GND" },
  schPinArrangement: {
    leftSide: { pins: [8, 5], direction: "top-to-bottom" },
    rightSide: { pins: [4], direction: "bottom-to-top" },
  } }));
const circuitJson = circuit.getCircuitJson();        // synchronous
const svg = convertCircuitJsonToSchematicSvg(circuitJson);
```

Things that memory got wrong and the installed types corrected:

- `new Trace(...).connect(...)` no longer exists. The `Trace` constructor validates `from`/`to`
  (or `path`, `start`, `end`) immediately, so the old chained form throws.
- `Chip` pin keys are `pin<number>`. A key such as `pin8` makes tscircuit report pin number 8, and
  a sparse set of keys draws only those pins.
- `manufacturerPartNumber` is the second text printed on a chip box; `value` is ignored there.
- `Net` draws a `rail_up`/`rail_down` symbol only with `isPowerNet`/`isGroundNet`. Without those
  flags, or for a named `Trace`, tscircuit draws a short wire ending in a net label.
- `schOrientation: "horizontal"` is the per-part switch for a two-terminal symbol.

## Converter: `baselines/scripts/tscircuit_draw.mjs`

Reads one neutral netlist and writes `attempt-K.input.json`, `attempt-K.svg`, `attempt-K.png` and
`attempt-K.check.txt`. No schematic coordinates and no trace paths are ever set. The rules:

- Built-in symbols for resistor, capacitor, polarised capacitor, inductor, diode, LED, battery,
  voltage source, NPN/PNP transistor, N-MOSFET/P-MOSFET, op-amp and crystal.
- Every other type (header, IC, module, relay, motor, unknown) becomes a `Chip` box. Only pins that
  appear in a net or in the netlist's `nc` list are drawn. A repeated pin name is made unique by
  appending the pin number (`GND_4`, `GND_22`). A numeric case pin number becomes the chip's real
  pin number, so an ATtiny's VCC is 8, not its position in the used set. A non-numeric pin number
  (relay `A1`, module `J2-1`) takes the lowest free number and keeps its real name as the label.
  Pins are split in declaration order, first half on the left, second half on the right.
- Power and ground nets become `Net` elements with the rail symbols. Every other net becomes
  `Trace` elements. A net with more than two pins is a star: one trace from the pin whose part has
  the most net memberships to each other pin.
- Net names are printed on signal traces and on every supply rail.

The op-amp mapping was checked against the drawn symbol: case pin `2` (IN-) maps to `pin2`, case pin
`3` (IN+) maps to `pin1`, case pin `1` (OUT) maps to `pin3`.

`baselines/scripts/run_tscircuit.sh` wraps the converter for `validation NN K` and
`neutral <name> K`. On this Windows machine it has to be run with Git Bash
(`C:\Program Files\Git\bin\bash.exe`); bare `bash` starts WSL, which has no distribution installed.

## Connection check

The check rebuilds connectivity from the schematic layer of the circuit JSON only:

- `schematic_port` gives a drawn pin and its position.
- `schematic_trace` gives wire segments and junctions. Ports and trace vertices at the same point
  are joined, and a T junction joins all branches.
- `schematic_net_label` gives a label, its anchor position and its text.

Same-named net labels are joined by text. This is needed because tscircuit ends a short wire at a
named label instead of routing a long wire across the sheet, so the label name is the drawn
connection. A supply rail label also gets a 0.2 stem from its anchor to the rail.

A pin with neither a wire nor a label stays alone and is reported as `EXTRA unconnected port`. An
expected net whose members are not all in one group is reported as `MISSING`. The source netlist is
used only for the expected groups and the pin names, never to repair a drawn connection. Unrouted
connections therefore count as missing.

## Neutral circuits and the tool-wide settings

Two self-written circuits in `baselines/scripts/tscircuit/neutral/`: a discrete common-emitter
amplifier and an ATtiny85 board with a crystal, decoupling and an LED. They are not cases and are
not counted attempts. Their runs are in `baselines/out/tscircuit/neutral/` (gitignored).

Settings chosen before any counted case, then left unchanged for every case:

1. Two-terminal passives horizontal: resistor, capacitor, polarised capacitor and inductor. This came
   from `common-emitter` attempt 1, where tscircuit's default orientation made C1 overlap R2
   (`Warning: 1 chip overlaps detected in final layout: C1 overlaps R2`). Attempt 3 with horizontal
   passives removed the warning.
2. A multi-pin signal net is a star from the pin whose part has the most net memberships.
3. Net names are printed on signal traces. Turning them off (attempt 2) let tscircuit auto-name
   traces `Q1_base`, `C2_pin1`, `C2_pin2`, which is worse.
4. Power and ground nets are named rails, not wires.
5. Default chip box sizes and tscircuit's own placement are kept. A 3.2 x 2.4 box (attempt 3 on
   `attiny85`) made large, mostly empty boxes, and chip size is not a tool-wide setting.

Other neutral runs, kept for the record: `common-emitter` a4 (rotating C1 and C2 by 180) was
pixel-identical to a3, and a6 (signal nets as `<net>` instead of traces) left V2[+], R1[2], Q1[B],
C2[1] and J1[1] unrouted, check FAIL. `attiny85` a1 passed the check but numbered U1's shown pins
1-6 instead of the ATtiny package numbers; that was a converter bug and is fixed.

Reference neutral images: `common-emitter/attempt-5.png` and `attiny85/attempt-2.png`. I opened both
and checked the drawing, not only the check text.

## Attempt 1 on the validation cases

Only attempt 1 was run, on cases 1 and 3. No revision was made, so the attempt budget for these
cases is untouched after attempt 1.

### Case 1: LED and resistor

Config `{}` (default settings). Check output
(`baselines/out/tscircuit/validation/case01/attempt-1.check.txt`):

```
n1 PWR: OK want=["B1[+]","R1[1]"] got=["B1[+]","R1[1]"]
n2 (unnamed): OK want=["D1[A]","R1[2]"] got=["D1[A]","R1[2]"]
n3 GND: OK want=["B1[-]","D1[K]"] got=["B1[-]","D1[K]"]
RESULT PASS
```

The drawing is clean: the battery sits at the left with a PWR rail on `+` and GND on `-`, R1 runs
horizontally to the LED, and the LED cathode ends at a GND rail. I opened `attempt-1.png`.

### Case 3: summing amplifier

Config `{}` (default settings). Check output
(`baselines/out/tscircuit/validation/case03/attempt-1.check.txt`):

```
n1 (unnamed): OK want=["R1[1]","V1[+]"] got=["R1[1]","V1[+]"]
n2 (unnamed): OK want=["R2[1]","V2[+]"] got=["R2[1]","V2[+]"]
n3 (unnamed): OK want=["R3[1]","V3[+]"] got=["R3[1]","V3[+]"]
n4 SUM: OK want=["R1[2]","R2[2]","R3[2]","Rf[1]","U1[2]"] got=["R1[2]","R2[2]","R3[2]","Rf[1]","U1[2]"]
n5 OUT: OK want=["RL[1]","Rf[2]","U1[1]"] got=["RL[1]","Rf[2]","U1[1]"]
n6 GND: OK want=["RL[2]","U1[3]","V1[-]","V2[-]","V3[-]"] got=["RL[2]","U1[3]","V1[-]","V2[-]","V3[-]"]
RESULT PASS
```

The drawing is honest but uglier than case 1. tscircuit places the three sources with their input
resistors as one cluster and the op-amp with Rf and RL as another, joined only by SUM, OUT and GND
net labels. The SUM labels are vertical and one of them sits on a wire; the op-amp's `+` input is
tied to a boxed GND label. This is tscircuit's own placement, and no hand placement was used to hide
it. I opened `attempt-1.png`.

## Files changed

New files:

- `baselines/scripts/tscircuit_draw.mjs`: converter, capture, rasterise and check.
- `baselines/scripts/run_tscircuit.sh`: runner for validation and neutral runs.
- `baselines/scripts/tscircuit/neutral/common-emitter.json`: neutral circuit 1.
- `baselines/scripts/tscircuit/neutral/attiny85.json`: neutral circuit 2.

Edited files:

- `baselines/VERSIONS.md`: tscircuit versions, install commands and API calls.
- `baselines/LOG.md`: tool-wide settings, neutral attempt log, case 1/3 attempts, known defects.
- `baselines/CONNECTIONS.md`: tscircuit check method and the case 1/3 check paths.
- `baselines/README.md`: folder layout, rerun steps, check and config levers.

Not touched: `README.md`, `SPEC.md`, `phase0/`, `tests/fixtures/`, `src/`, `package.json`,
`baselines/scripts/rasterize.mjs`, `baselines/scripts/normalize.ts`.

## Commands run and results

```
npm run typecheck
> tsc --noEmit
(no errors)

npm test
Test Files  17 passed (17)
Tests       461 passed (461)

npm run phase0
case01-led to case08-diffpair: all 8 status "valid"
(validation subset only; the runner reports gates 1-6 as incomplete because held-out
 test cases and blind owner ratings are outside this run)
```

The tscircuit runs themselves:

```
"C:\Program Files\Git\bin\bash.exe" baselines/scripts/run_tscircuit.sh validation 01 1
check: PASS
"C:\Program Files\Git\bin\bash.exe" baselines/scripts/run_tscircuit.sh validation 03 1
check: PASS
```

I also checked that the new and changed text has no en or em dashes, and ran `node --check` on the
converter.

## Skipped or not done

- Part B: no `final.png` for any tscircuit case, no other validation cases, no attempt 2 or later.
- No held-out test set was opened, listed or run, and `normalize.ts` was not run.
- No test was changed to make it pass.
- No package was added to the repo.

## Open questions for the lead

1. The check joins same-named `schematic_net_label` texts, because tscircuit uses a label to end a
   wire instead of routing across the sheet. Is that acceptable as the tscircuit check rule, or
   should only supply-rail labels join by name in Part B?
2. Case 3's SUM labels are vertical and one sits on a wire. That is tscircuit's own layout, and Part
   A does not allow hand placement. Should Part B try a converter setting that might change it, or
   keep the honest first drawing?
3. Chip boxes show real package pin numbers when the case pin is numeric, and lowest free ordinals
   otherwise. Is that the convention the showcase wants for modules and relays?
