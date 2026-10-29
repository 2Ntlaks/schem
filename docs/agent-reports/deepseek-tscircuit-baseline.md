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

# tscircuit baseline, Part B

Branch: `deepseek/tscircuit-baseline`. Part B commits on top of the Part A commit. Nothing was
pushed or merged.

Part B ran attempt 1 on cases 2 and 4-8, reviewed every attempt image, revised within the budget,
and chose `final.png` for the cases whose check passes. Six cases have a passing final. Cases 5 and
8 do not: every one of their four attempts fails the schematic-level check, and the brief says a
drawing whose check fails cannot be chosen as final.

## Converter changes made before the counted attempts

All four are tool-wide behaviour, not per-case hand placement, and none sets a coordinate or a trace
path.

1. `parts.<ref>.rotation` is now passed to the component constructor as `schRotation`. Setting
   `component.schRotation` after construction had no effect. A per-part rotation also clears the
   tool-wide `schOrientation`, because tscircuit ignores `schRotation` when both are set.
2. Chip boxes accept `parts.<ref>.pinSides = { left, right, leftDirection, rightDirection }`. The
   arrays name case pin numbers; the converter maps them to tscircuit pin ordinals and rejects a list
   that misses a drawn pin. This chooses a pin side or order only.
3. Net names that tscircuit rejects (a leading digit, `+`, `-`, a period or a space) get an internal
   `ALIAS_*` name. After `getCircuitJson()` the real name is restored on `source_net.name` and on the
   matching `schematic_net_label.text`. Only text changes; the layout is untouched.
4. The converter header now records the DC-source decision from Part A (`vsource` without a
   frequency uses `Battery`, with a frequency uses `VoltageSource`), the alias rule and the
   `pinSides` lever.

## Results per case

| Case | Attempts | Check | Final | Reason |
|---|---|---|---|---|
| 1 | 1 | PASS | a1 | clean loop and correct LED; only B1's value is missing |
| 2 | 2 | PASS | a2 | a1's GND label sits on C1's wire; C1 rotated 180 fixes it |
| 3 | 4 | PASS | a1 | conventional left-to-right summer; a4 is mirrored, a3 is scattered |
| 4 | 4 | PASS | a4 | one missing MOSFET symbol (Q3) instead of two, and GND is off the OUTA wire |
| 5 | 4 | FAIL | none | the 3V3 rail never reaches the U1/U2/U3 VIN group |
| 6 | 1 | PASS | a1 | relay, flyback diode, contacts and load are all drawn clearly |
| 7 | 4 | PASS | a4 | only passing attempt; U2's GND flag overlaps the SCL label |
| 8 | 4 | FAIL | none | Q3's base trace stops 0.015 units short of the pin |

Attempts used: 24 in total, at most 4 in any case, so every case stayed inside the 1 + 3 budget.

## Image review

I opened every attempt PNG at full size. I cropped and enlarged the areas that needed a closer
look, at 2x to 10x: the battery and LED in case 1; the GND label at C1 in case 2; the op-amp and
SUM labels in case 3; the MOSFETs and M1 labels in case 4; the 3V3 rail in case 5; the relay in
case 6; U2 and the capacitor bus in case 7; and the Q3 base in case 8. I did not call an image clean
from the whole-sheet view alone.

What the review found:

- Case 1: the battery, PWR/GND rails, R1 and the LED are clear at 4x. B1 prints only its reference;
  tscircuit's `Battery` symbol accepts `voltage` but never draws it.
- Case 2 a1: at 8x the GND label box at C1's left plate has the C1 wire running through it. a2
  rotates C1 and the label is clear; the "VREF" text still nearly touches R2's reference but both
  are readable.
- Case 3: a1 has the conventional orientation; its upper SUM label is vertical and sits on the
  summing wire. a2 is byte-identical to a1 (the rotation never reached tscircuit). a3 points the
  op-amp down and scatters the source cluster; a4 is mirrored. All four pass; a1 is the easiest to
  read.
- Case 4: a1 and a2 are missing both Q2 and Q3; tscircuit writes red "Could not match ports for
  symbol (n_channel_e_mosfet_transistor...)" text in their places. a3 passes but still misses both
  symbols, and its GND label sits on the OUTA wire. a4 rotates Q2 and draws it; Q3 is still missing
  and the red text crosses the OUTB label. The layout also uses auto net names such as `Q1_pin3`.
- Case 5: all four attempts draw the 3V3 rail at R1/R2 only. The U1/U2/U3 VIN bus has no 3V3 label,
  and the rail stub stops about 0.4 units short of the bus; the gap is clear at 6x.
- Case 6: the relay coil, D1, Q1, the contacts and J1 LOAD are clear at 6x. K1's contacts and J1 are
  joined by the auto label `K1_COM`. D1 and Q1 show no part values.
- Case 7: a1 merges 5V and GND because the GND label at U2's WP pin sits on the 5V wire. a2 and a3
  leave R2[1] and U2[8] out of the 5V group and put the SDA label on R2's value. a4 passes, but U2's
  WP GND flag is drawn on top of the vertical SCL label, so those two texts overlap.
- Case 8: a1 to a4 all leave Q3's base disconnected. At 6x to 8x the base trace stops a hairline
  short of the pin (0.015 units at a4). Rotations 90 and 270 move the layout but not the gap.

## Nets joined only by same-named labels

`baselines/CONNECTIONS.md` records these per case. In summary:

- Case 1: GND.
- Case 2: 9V, VOUT, GND.
- Case 3: GND.
- Case 4: 12V, GND, OUTA, OUTB, plus the four unnamed gate nets joined by tscircuit's auto labels
  `Q1_pin3` to `Q4_pin3`.
- Case 5: no final; the failing 3V3 net has labels only on the R1/R2 group.
- Case 6: 5V, GND, plus the unnamed base net (`Q1_base`) and relay common net (`K1_COM`).
- Case 7: 5V, GND, SCL.
- Case 8: no final; the attempts join +12V, -12V and GND by name.

## Files changed in Part B

- `baselines/scripts/tscircuit_draw.mjs`: the four converter changes above.
- `baselines/LOG.md`: Part B status, all 24 attempts, per-image observations, final choices, known
  defects and the two tool failures.
- `baselines/CONNECTIONS.md`: tscircuit final and check paths for cases 1, 2, 3, 4, 6 and 7; the
  label-joined nets; the case 5 and 8 failures.
- `baselines/README.md`: Part B status, six finals, the `pinSides` lever.
- `baselines/VERSIONS.md`: schematic behaviour notes for rotation, battery values, pin sides, net
  aliases, the missing n-MOSFET symbol and the 0.015-unit trace gap.
- `docs/agent-reports/deepseek-tscircuit-baseline.md`: this Part B report.

The attempt configs, SVGs, PNGs, check files and `final.png` copies are under
`baselines/out/tscircuit/validation/`, which is gitignored. Six `final.png` files were copied:
case 1 a1, case 2 a2, case 3 a1, case 4 a4, case 6 a1, case 7 a4. Cases 5 and 8 have none.

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
(the runner reports gates 1-6 as incomplete because held-out test cases and blind owner
 ratings are outside this run)
```

The Part B tscircuit runs were made with:

```
"C:\Program Files\Git\bin\bash.exe" baselines/scripts/run_tscircuit.sh validation NN K
```

Each printed `check: PASS` or `check: FAIL`; the per-attempt result is in
`baselines/out/tscircuit/validation/caseNN/attempt-K.check.txt` and is logged in `LOG.md`.

I checked that the changed text has no en or em dashes, and ran the replay check on every attempt
input to confirm the recorded PASS/FAIL results.

## Skipped or could not do

- Cases 5 and 8 have no `final.png`. Their four attempts each fail the check. I did not run a fifth
  attempt because the budget is 1 initial attempt plus at most 3 revisions per case.
- Case 4's final still has Q3 missing. The check passes because Q3's schematic ports and traces
  exist, but the symbol is not drawn. A fifth attempt rotating Q3 to 90 might draw it (Q2 did at 90),
  but that is outside the budget.
- No held-out test set was opened, listed or run, and `normalize.ts` was not run.
- No test was changed to make it pass. No package was added to the repo.

## Open questions for the lead

1. Cases 5 and 8 cannot meet "every validation case has a final with a passing check" inside the
   budget. Should they be accepted as documented tool failures with no final, as recorded in
   `LOG.md` and `CONNECTIONS.md`, or do you authorise a fifth attempt for each outside the budget?
   For case 5 the blocker is tscircuit placing all 3V3 labels on the R1/R2 island; for case 8 it is
   the 0.015-unit base trace gap.
2. Case 4's final passes but has no Q3 symbol. Is a passing check with one missing symbol acceptable
   as the honest tscircuit final, or should case 4 also be reported as a tool failure with no final?
3. Should the showcase text state that tscircuit does not draw battery values, diode and transistor
   part numbers, or does it want those listed only in `LOG.md`?


# tscircuit baseline, Part C (finished by the lead)

DeepSeek's usage ran out during Part C, after the work below and before its report. The lead committed its work as it stood (8089736), reviewed it, and finished the part.

Done by DeepSeek, reviewed and kept:
- The 0.02-unit touch rule in the connection check (true point-to-point and point-to-segment distances, labels included) and a `--replay` mode. All 24 attempt checks were replayed; no new attempt was made. The replay confirmed case 8 (all four attempts pass; the Q3 base gap is 0.015 units, thinner than the wire). It did not confirm the lead's prediction for case 3: attempts 1 and 2 still pass (the GND label's lead stops 0.031 units from the SUM wire), so case 3's final was chosen from all passing attempts; a4 stays, because a1 and a2 draw the GND label box over a wire. It also turned case 7 a4 into a fail, because the GND rail is drawn through C2[1]'s pin, which reads as 5 V shorted to ground. tscircuit therefore has finals for cases 1, 2, 3, 4, 6 and 8, and none for 5 and 7.
- `scripts/showcase.ts`: tscircuit as the second column, case 8 back in, text cells for cases with no final, the tool-failure caption for tscircuit case 4, and the note on values tscircuit does not print.

Finished by the lead:
- Merged `main` (bus corridors, playground, docs page) and rebuilt our drawings (`npm run phase0`, 8 of 8 valid) and the page from a deleted `docs/showcase/`: 33 images (7 circuits x 5 tools, less tscircuit's cases 5 and 7), `comparison.png` 553 KB. Every cell checked for the right tool and circuit; cells are about 470 x 330 px in the overview, and the page opens every drawing at full size. The page has no broken images and no sideways scroll at 390 px.
- README "How it compares", `docs/README.md` and `baselines/README.md` updated for five tools, the tscircuit tool failure and missing drawings, and case 8's return.
