# Baselines log (validation cases 1-8)

Test-case entries (cases 9-12) are in `LOG-test.md`, which the layout builder must not open before the end gate.

Budget (SPEC 15): 1 initial attempt + at most 3 revisions per tool per case. Every attempt keeps its image
(`out/<tool>/validation/caseNN/attempt-K.png`), its input or code, and its connection check (`attempt-K.check.txt`).

## Harness decisions made before any counted attempt

These are tool-wide settings, chosen on neutral circuits that are not cases (a common-emitter amplifier and an
ATtiny85 board) or forced by bugs in the harness, and they apply to every case equally:

- **Rasteriser** (`scripts/rasterize.mjs`): view box set to the drawn content (text included) plus 4 % padding,
  longer side 1600 px, white background, DejaVu fonts only. Earlier runs used a fixed 1600 px width and clipped
  netlistsvg's outer labels; all images were re-rendered with the final settings.
- **SKiDL**: `generate_svg(flatness=1.0, seed=1, auto_stub=False)`; when the wired router raises
  `RoutingFailure`, the same attempt falls back to `auto_stub=True` (generate_svg's own default). On the neutral
  circuits the wired mode was clearly better; label mode overlaps parts. Title block text is "Case N", because the
  default text names SKiDL and would unblind the judges. Generated box symbols put their outline in unit 1
  (in unit 0 SKiDL drew the outline twice, the second copy hiding the pin names). Probe parts are templates (a probe
  had stolen reference Q1, renaming the real part Q1_1). The schematizer options that `generate_svg` accepts are
  `retries`, `auto_stub`, `auto_stub_fanout`, `auto_stub_max_wire_pins`, `auto_stub_max_wire_dist`,
  `auto_stub_fallback` and `label_clearance`. `expansion_factor` is internal: passing it raises
  `TypeError: _place_and_classify() got multiple values for argument 'expansion_factor'`.
- **netlistsvg**: analog skin unmodified; conversion rules in `scripts/netlistsvg_draw.mjs` header. Power and
  ground nets are split into one symbol per pin, as the skin's own examples do. This is a tool-wide setting and is
  kept for every case; no case uses `noSplitNets` to make its drawing look more like a closed loop.
- **schemdraw**: hand-written per case; `scripts/schemdraw_kit.py` checks connections from the drawing geometry.
  Free `S.text` is used for ref/value labels that are not net names, because element labels on rotated parts flip
  sides unpredictably. Free text never joins nets, so it cannot hide a connection.

## Status after Part A

All eight validation cases have a `final.png` for all three tools. All 24 final checks PASS.

Attempts used: schemdraw 27 (max 4 in a case), SKiDL 16 (max 4), netlistsvg 19 (max 4). Two further SKiDL runs
failed in the harness before producing an image (see case 4 and case 7 below); they are not counted as attempts.

| Case | schemdraw final | SKiDL final | netlistsvg final |
|---|---|---|---|
| 1 | 3: "+" beside the positive plate | 1: wired loop; PWR label on the frame | 2: R1 horizontal, 470 clear of B1 |
| 2 | 3: VOUT and "+" clear of wires | 1: C1 value runs into R2 | 1: clean |
| 3 | 1: clean summing amplifier | 1: V1 label collides with V2 | 1: readable summer; R1 text crosses Rf wire |
| 4 | 4: all part labels clear of wires | 4: ICs separated, J1 pile at top right | 2: logical port sides; M1 title crossed |
| 5 | 4: pull-up labels off the buses | 1: U1 squeezed, R1 value on its body | 1: clean |
| 6 | 4: R1 ends at the tap | 1: relay drawn; U1 value crossed | 4: titles clear of 5V/GND |
| 7 | 4: SDA/SCL labels off the wires | 4: ICs only, passives hidden (tool failure) | 2: shorter titles, less crowding |
| 8 | 4: labels clear, mirror wire orthogonal | 1: pair and mirror; Q3 value crossed | 1: clean pair and mirror |

## Attempts

### schemdraw

Case 1:
- a1: single loop; the battery "+" label sat below the battery, away from the positive plate. Check PASS.
- a2: "+" moved to the top of the battery, but that is the long lead, not the plate.
- a3: the plates sit at y 1.78 to 1.22 (not at the start anchor at 3.0), so "+" moved beside them. Chosen.

Case 2:
- a1: VOUT label sat on the feedback corner; "+" was far from the plate.
- a2: "+" moved beside the plate (still on the lead) and VOUT moved along the output wire.
- a3: "+" at y 5.78 beside the plate stack; VOUT is free text above the wire. Chosen.

Case 3:
- a1: clean summing amplifier; no revision needed. Chosen.

Case 4:
- a1: Q2/Q4 value labels ran into the R6/R8 labels; 12V and OUTB text sat on wires.
- a2: Q2/Q4 labels moved out, OUTA/OUTB below the wires, "+" beside the battery (still on the lead).
- a3: OUTA/OUTB became free text just below the wires (the label elements straddled them); "+" moved to 6.78.
- a4: Q1/Q3 ref/value labels were crossed by the drain wires; both moved to free text clear of the bodies.
  Chosen.

Case 5:
- a1: check FAIL. The shared kit `ic()` gave both sensors the same anchor names, so the second sensor's bus
  wires were drawn from the first sensor's pins and SDA/SCL merged.
- a2: local `ic()` with reference-prefixed anchors, sensors' bus pins on their left side. Check PASS. The pull-up
  labels sat on the bus wires.
- a3: R1's label moved to `loc="left"`; it still landed on the IO21 wire, and R2's on SCL.
- a4: both pull-up labels replaced by free text beside the bodies. Chosen.

Case 6:
- a1: U1 value "ESP32-DevKitC" ran into the IO26 pin name; K1 had no visible label; the load header was too
  cramped for COM/NO/NC.
- a2: value shortened to "ESP32-DevKitC" (still too wide), K1 label added, roomy three-pin load box.
- a3: value shortened to "ESP32"; the rest unchanged. One NC/NO wire crossing remains, drawn without a junction
  dot. R1 also ran from 5.6 to its default end near 8.6 while the R2/Q1 base wire tapped at 7.5, so the base wire
  left the middle of R1's lead and the last part of the lead dangled.
- a4: R1 ends at the tap (5.6 to 7.5) and the base wire starts at its end. Check PASS. Chosen. The two long 5 V and
  GND rails still end in space at the right (see known defects).

Case 7:
- a1: each capacitor on its own 5 V symbol; four symbols and labels crowded J1's wire, and U1's top pin labels
  ran together.
- a2: shared 5 V rail and wider pin spacing; element labels on the vertical capacitors flipped to the rail side,
  putting C2/C4 values on the rail.
- a3: capacitor labels as free text under the ground symbols, resistor labels beside the bodies, J1 leads
  orthogonal. The SDA and SCL labels used `S.label(..., loc="top")` and `S.label(..., loc="bottom")`, but the bus
  wires still ran through the middle of both words.
- a4: SDA and SCL are free text above and below their wires instead. Check PASS. Chosen.

Case 8:
- a1: source labels sat on wires and the mirror connection ran diagonally.
- a2: wider grid and separate wire levels for the mirror and output nodes; some labels still on wires.
- a3: source and transistor labels as free text, MIRROR/OUT/TAIL beside their wires, orthogonal mirror wire, Q2
  base stub.
- a4: MIRROR centred under the wire (attempt 3's text crossed Q1's collector wire). Chosen.

### SKiDL

Cases 1, 2, 3, 5, 6 and 8 drew in wired mode at attempt 1 and were accepted after image review. Cases 4 and 7
failed wired routing and fell back to label mode; their revisions explored seeds and thresholds.

Case 1:
- a1: wired LED loop; the circuit is small on the sheet and the PWR label sits on the top frame line. Chosen.

Case 2:
- a1: wired divider and buffer; C1's "100n" value runs into the top-left corner of R2's body. Chosen with that
  defect.

Case 3:
- a1: wired; the three sources and their resistors are readable, with long supply wires. V1's "1V" overlaps V2's
  "V2" and the vertical GND label beside them. Chosen with that defect.

Case 4:
- a1: wired routing failed (`RoutingFailure`); the fallback drew the bridge as a vertical chain, the drive header
  crushed at the top, and Q1, Q2 and M1 overlapping.
- a2: seed 2, `retries` 4, `auto_stub` off. The first run of this attempt used the invalid `expansion_factor` key
  and raised `TypeError` before drawing (no image). Rerun without it: the router failed again and the fallback
  scattered the parts, worse than a1.
- a3: seed 3, `auto_stub` on. The parts separated into a horizontal chain, but Q3/R7 and the Q1/M1 pair still
  overlap.
- a4: seed 4, `auto_stub` on. Best separation of the four: Q3, R7, Q1, M1, Q2 and Q4 are each visible. J1's five
  series resistors and their pin labels are still a pile at the top right, R5's "10k" sits on its own down wire,
  and two "12V" texts collide near B1. Chosen with those defects.

Case 5:
- a1: wired; all parts drawn. U2's box touches the left frame. U1 is squeezed into a narrow box between the two
  sensors, its "ESP32-DevKitC" value crosses a wire, and R1's "4.7k" value sits on R1's body. The I2C wires loop
  on the right.
- a2: seed 2. U1 squeezed between the sensors, labels stacked on its pins, more crossed wires. Worse.
- a3: seed 3. Same squeezed U1 and clipped outer boxes. No better.
- a1 chosen.

Case 6:
- a1: wired: relay with coil and contact, flyback diode, NPN, base resistor and load connector. U1's
  "ESP32-DevKitC V4" value is crossed by a vertical wire near its right end. Chosen with that defect.

Case 7:
- a1: wired routing failed; the fallback stacked C1-C4, R1-R3 and J1 at one point behind U1, so the drawing
  shows only the two ICs and their labels.
- a2: seed 2, `retries` 4, `auto_stub` off. The router failed and fell back again; same hidden passives,
  slightly different IC placement. (The first run of this attempt hit the same `expansion_factor` `TypeError` as
  case 4 and drew nothing.)
- a3: seed 3, `auto_stub` on. Same defect, U1 one step lower.
- a4: seed 4, `auto_stub` on. The two ICs have the most room of the four, but the passives are still hidden. Tool
  failure: passives stacked behind U1, only the two ICs visible. Chosen as the least crowded; defect reported.

Case 8:
- a1: wired, all parts drawn; Q3's "2N3906" value is crossed by its emitter wire. Chosen with that defect.

### netlistsvg

Case 1:
- a1: loop; the 5 V net becomes two PWR symbols under the tool-wide split setting, but "470" runs into the B1
  circle.
- a2: R1 uses the skin's horizontal resistor (`r_h`), so its ref and value sit above and below the body, clear of
  B1. Check PASS. Chosen. The rectangular body differs from the zigzag `r_v` used in other cases; that is a style
  choice, not a connection change.

Case 2:
- a1: clean; op-amp, feedback and load all readable. Chosen.

Case 3:
- a1: the only text collision is R1's "R1" and "10k", which cross the feedback wire beside Rf; long wires from the
  two outer sources also cross the middle.
- a2: R1's `dirs` swapped to A=output, B=input. The drawing is unchanged; the label still crosses the wire.
- a3: R1 changed to the horizontal `r_h`. The text is now above and below the body and clear, but the SUM net is
  routed as a closed rectangle around R1 and R1's left lead crosses the SUM wire without a junction dot. That is
  more misleading than the text collision.
- a4: a3 plus R1 `dirs` A=input, B=output. The drawing is identical to a3. Check PASS.
  a1 kept as final; the Rf-wire text collision is reported.

Case 4:
- a1: all transistor ports defaulted to outputs, so each generic box had its three ports on one side and many
  wires crossed the sheet.
- a2: `dirs` set to gate=input, source=input, drain=output for Q1-Q4, and J1's four drive pins to output. The
  bridge lays out with Q3/Q4 on the right and clearly fewer crossings. The M1 title "M1 12 V DC motor" is crossed
  by two vertical wires.
- a3: M1's pins set 1=input, 2=output. M1 moved to the far right, but its title is still crossed by the vertical
  wire through "motor", and the bridge now has long crossing wires across the top.
- a4: M1's pins set 1=output, 2=input. M1 sits beside Q4 and its title runs into Q4's "drain" label. Worse.
  a2 kept as final; the M1 title crossing is reported.

Case 5:
- a1: clean; both sensors and both pull-ups clear, buses straight. Chosen.

Case 6:
- a1: relay, flyback, transistor and load readable, but the U1 title crosses the 5 V wire and the K1 title crosses
  the GND and 5 V wires.
- a2: U1's 5 V pin set to output and K1's A1 to input. The 5 V symbols moved, but the titles still cross wires and
  the A1 label now runs into the GND text. Worse.
- a3: titles shortened to "U1 ESP32" and "K1 relay". Both clear the wires. Check PASS.
- a4: titles set to "U1 ESP32" and "K1 5 V relay", keeping the relay voltage and losing only the part numbers.
  Clear of the wires. Check PASS. Chosen; the shortened titles are noted in the known defects.

Case 7:
- a1: all parts drawn. U1/U2 titles repeat the part number and crowd their pin names; the SDA wire passes near the
  U2 title.
- a2: titles shortened to "U1 ATmega328P" and "U2 24LC256", removing the duplicate part numbers and the long
  overhang. Check PASS. Chosen; the titles still sit just above the VCC labels, which is the skin's fixed title
  position.

Case 8:
- a1: clean pair and mirror. The OUT rail (Q2[C], Q4[C], RL[1]) and +12 V (Q3[E], Q4[E], V2[+]) are separate
  nets and their wires do not touch. Chosen.

## Known defects in the finals

These are left in place because the tool, not the harness, produced them, and the budget is spent (or the defect is
in the tool's fixed symbol drawing):

- schemdraw case 6: the long 5 V and GND rails end in space at the right. One NC/NO wire crossing is drawn without
  a junction dot, which is correct because the nets are not joined.
- SKiDL case 1: the PWR net label sits on the top frame line. The circuit itself is clear.
- SKiDL case 2: C1's "100n" value runs into the top-left corner of R2's body.
- SKiDL case 3: V1's "1V" overlaps V2's "V2" and the vertical GND label beside them.
- SKiDL case 4: J1's five series resistors and their pin labels overlap at the top right; R5's "10k" sits on its
  own down wire; two "12V" texts collide near B1.
- SKiDL case 5: U2's box touches the left frame; U1 is squeezed between the two sensors and its value crosses a
  wire; R1's "4.7k" sits on R1's body.
- SKiDL case 6: U1's "ESP32-DevKitC V4" value is crossed by a vertical wire near its right end.
- SKiDL case 7: tool failure: passives stacked behind U1, only the two ICs visible. Kept as the final.
- SKiDL case 8: Q3's "2N3906" value is crossed by its emitter wire.
- netlistsvg case 3: R1's "R1" and "10k" text crosses the feedback wire beside Rf, and two long source wires cross
  the middle of the drawing. The horizontal R1 revision removed the text collision but wrapped R1 in a closed SUM
  loop with a wire crossing its lead, which is more misleading.
- netlistsvg case 4: the M1 title "M1 12 V DC motor" is crossed by two vertical wires.
- netlistsvg case 6: the titles were shortened to "U1 ESP32" and "K1 5 V relay" to clear the 5 V and GND wires, so
  the part numbers "DevKitC V4" and "SRD-05VDC-SL-C" are no longer shown.
- netlistsvg case 7: the shortened titles still sit directly above the VCC pin labels; that is the generic skin's
  fixed title position.

## Note for the judge kit

The judge kit wants `<tool>__caseNN.png` in one folder; copy the `final.png` files that way.
