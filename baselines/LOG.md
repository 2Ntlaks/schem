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

Attempts used: schemdraw 25 (max 4 in a case), SKiDL 16 (max 4), netlistsvg 9 (max 2). Two further SKiDL runs
failed in the harness before producing an image (see case 4 and case 7 below); they are not counted as attempts.

| Case | schemdraw final | SKiDL final | netlistsvg final |
|---|---|---|---|
| 1 | 3: "+" beside the positive plate | 1: clean wired loop | 1: clean split-power loop |
| 2 | 3: VOUT and "+" clear of wires | 1: clean divider and follower | 1: clean |
| 3 | 1: clean summing amplifier | 1: readable summer | 1: readable summer, no overlaps |
| 4 | 4: all part labels clear of wires | 4: best of four seeds, parts separated | 2: transistor ports on logical sides |
| 5 | 4: pull-up labels off the buses | 1: only seed with U1 not squeezed | 1: clean |
| 6 | 3: U1 value fits, relay labelled | 1: full relay circuit drawn cleanly | 1: clean |
| 7 | 3: labels clear, orthogonal leads | 4: ICs clear, passives hidden | 1: all parts drawn, titles busy |
| 8 | 4: labels clear, mirror wire orthogonal | 1: clean pair and mirror | 1: clean pair and mirror |

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
- a3: value shortened to "ESP32"; the rest unchanged. Chosen. One NC/NO wire crossing remains, drawn without a
  junction dot.

Case 7:
- a1: each capacitor on its own 5 V symbol; four symbols and labels crowded J1's wire, and U1's top pin labels
  ran together.
- a2: shared 5 V rail and wider pin spacing; element labels on the vertical capacitors flipped to the rail side,
  putting C2/C4 values on the rail.
- a3: capacitor labels as free text under the ground symbols, resistor labels beside the bodies, J1 leads
  orthogonal. Chosen.

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
- a1: wired, clean LED loop. Chosen.

Case 2:
- a1: wired, clean divider and buffer; C1 and R2 labels are close but do not overlap. Chosen.

Case 3:
- a1: wired; the three sources and their resistors are readable, with long supply wires but no overlaps. Chosen.

Case 4:
- a1: wired routing failed (`RoutingFailure`); the fallback drew the bridge as a vertical chain, the drive header
  crushed at the top, and Q1, Q2 and M1 overlapping.
- a2: seed 2, `retries` 4, `auto_stub` off. The first run of this attempt used the invalid `expansion_factor` key
  and raised `TypeError` before drawing (no image). Rerun without it: the router failed again and the fallback
  scattered the parts, worse than a1.
- a3: seed 3, `auto_stub` on. The parts separated into a horizontal chain, but Q3/R7 and the Q1/M1 pair still
  overlap.
- a4: seed 4, `auto_stub` on. Best separation of the four: Q3, R7, Q1, M1, Q2 and Q4 are each visible, though
  R5's value sits on R7 and two "12V" texts collide. Chosen.

Case 5:
- a1: wired; all parts drawn, but the U2 and U3 boxes touch the sheet frame and their values are clipped at the
  edges. The I2C wires loop on the right.
- a2: seed 2. U1 squeezed between the sensors, labels stacked on its pins, more crossed wires. Worse.
- a3: seed 3. Same squeezed U1 and clipped outer boxes. No better.
- a1 chosen.

Case 6:
- a1: wired, clean: relay with coil and contact, flyback diode, NPN, base resistor and load connector. Chosen.

Case 7:
- a1: wired routing failed; the fallback stacked C1-C4, R1-R3 and J1 at one point behind U1, so the drawing
  shows only the two ICs and their labels.
- a2: seed 2, `retries` 4, `auto_stub` off. The router failed and fell back again; same hidden passives,
  slightly different IC placement. (The first run of this attempt hit the same `expansion_factor` `TypeError` as
  case 4 and drew nothing.)
- a3: seed 3, `auto_stub` on. Same defect, U1 one step lower.
- a4: seed 4, `auto_stub` on. The two ICs have the most room of the four; the passives are still hidden. Chosen
  as the least crowded, with the defect reported.

Case 8:
- a1: wired, all parts drawn; RL's label overlaps its body slightly. Chosen.

### netlistsvg

Case 1:
- a1: clean loop; the 5 V net becomes two PWR symbols under the tool-wide split setting. Chosen.

Case 2:
- a1: clean; op-amp, feedback and load all readable. Chosen.

Case 3:
- a1: no overlapping text or parts, but long wires from the two outer sources cross the middle. Chosen.

Case 4:
- a1: all transistor ports defaulted to outputs, so each generic box had its three ports on one side and many
  wires crossed the sheet.
- a2: `dirs` set to gate=input, source=input, drain=output for Q1-Q4, and J1's four drive pins to output. The
  bridge lays out with Q3/Q4 on the right and clearly fewer crossings. Chosen.

Case 5:
- a1: clean; both sensors and both pull-ups clear, buses straight. Chosen.

Case 6:
- a1: clean; relay, flyback, transistor and load readable. Chosen.

Case 7:
- a1: all parts drawn. U1/U2 titles sit close to their pin names and the SDA wire passes near the U2 title, but
  no overlap hides a connection. Chosen.

Case 8:
- a1: clean pair and mirror. The OUT rail (Q2[C], Q4[C], RL[1]) and +12 V (Q3[E], Q4[E], V2[+]) are separate
  nets and their wires do not touch. Chosen.

## Known defects in the finals

These are left in place because the tool, not the harness, produced them, and the budget is spent:

- SKiDL case 4: R5's value sits on R7 and two "12V" labels collide. The bridge is otherwise separated.
- SKiDL case 5: the U2 and U3 boxes touch the sheet frame and their values are clipped.
- SKiDL case 7: C1-C4, R1-R3 and J1 are stacked at one point behind U1, so only the two ICs are visible.
- netlistsvg case 3: two long source wires cross the middle of the drawing.

## Note for the judge kit

The judge kit wants `<tool>__caseNN.png` in one folder; copy the `final.png` files that way.
