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
- **tscircuit** (Parts A and B): conversion rules in `scripts/tscircuit_draw.mjs` header. Tool-wide settings
  chosen on the two neutral circuits in `scripts/tscircuit/neutral/`, then left unchanged:
  two-terminal passives horizontal (resistors, capacitors, polarised capacitors, inductors); a multi-pin signal
  net drawn as a star from the pin whose part has the most net memberships; net names printed on signal traces;
  power and ground nets as named rails. Default chip box sizes and tscircuit's own part placement are kept. The
  neutral runs: `common-emitter` attempt 1 (default orientations) overlapped C1 and R2; attempt 3 with horizontal
  passives removed the overlap (no layout warnings) but kept tscircuit's vertical signal labels, which overlap
  some wires; attempt 5 repeated that setting and is the reference image. `attiny85` attempt 2 is the reference
  image: real ATtiny pin numbers (VCC 8, GND 4) are shown, and the power section is placed as a separate cluster
  joined by VCC/GND rails. Earlier neutral attempts kept for the record: common-emitter a2 (no signal net names:
  tscircuit auto-labelled traces "Q1_base" and "C2_pin2", worse), a4 (rotating the capacitors changed nothing),
  a6 (signal nets as `<net>`: tscircuit left some pins unrouted, check FAIL), attiny85 a1 (pin numbers were
  ordinal 1-6, not the real package numbers) and a3 (chip boxes 3.2x2.4 made large mostly-empty boxes). Chip box
  size and per-part rotation are available in the config but are not part of the default setting. Part B used
  only the allowed per-part levers (rotation, pin sides and order) and the converter fixes listed under Part B;
  no coordinate or trace path is set.

Part B converter fixes (tool-wide, before the counted attempts in each case): per-part `rotation` is now passed
to the component constructor as `schRotation` (setting it after construction had no effect) and a part rotation
now wins over the tool-wide horizontal default; chip boxes accept `pinSides` (`left`, `right`, optional
`leftDirection`/`rightDirection`) so a revision can choose a pin side or order; and net names that tscircuit
rejects (a leading digit, `+`, `-`, a period or a space) get a safe internal alias, with the real name restored
on the source net and its drawn labels after `getCircuitJson()`. Only the label text changes; the layout is
tscircuit's.

## Status after Part A

All eight validation cases have a `final.png` for all three tools. All 24 final checks PASS.

Attempts used: schemdraw 27 (max 4 in a case), SKiDL 16 (max 4), netlistsvg 19 (max 4). Two further SKiDL runs
failed in the harness before producing an image (see case 4 and case 7 below); they are not counted as attempts.

tscircuit is a separate later addition. Part A had attempt 1 on cases 1 and 3 only (both PASS). Part B ran cases
2 and 4-8 and chose finals for six cases; cases 5 and 8 have no final because every attempt's check fails (see
below). Attempts used for tscircuit: 24 (case 1: 1; case 2: 2; case 3: 4; case 4: 4; case 5: 4; case 6: 1;
case 7: 4; case 8: 4), so no case used more than the 1 + 3 budget.

| Case | schemdraw final | SKiDL final | netlistsvg final | tscircuit final |
|---|---|---|---|---|
| 1 | 3: "+" beside the positive plate | 1: wired loop; PWR label on the frame | 2: R1 horizontal, 470 clear of B1 | 1: clean loop; B1 value not drawn |
| 2 | 3: VOUT and "+" clear of wires | 1: C1 value runs into R2 | 1: clean | 2: C1 rotated, GND label clear |
| 3 | 1: clean summing amplifier | 1: V1 label collides with V2 | 1: readable summer; R1 text crosses Rf wire | 1: conventional summer; SUM label vertical |
| 4 | 4: all part labels clear of wires | 4: ICs separated, J1 pile at top right | 2: logical port sides; M1 title crossed | 4: Q3 symbol missing (tool error text) |
| 5 | 4: pull-up labels off the buses | 1: U1 squeezed, R1 value on its body | 1: clean | none: all 4 checks FAIL (3V3 island) |
| 6 | 4: R1 ends at the tap | 1: relay drawn; U1 value crossed | 4: titles clear of 5V/GND | 1: relay and contacts clear |
| 7 | 4: SDA/SCL labels off the wires | 4: ICs only, passives hidden (tool failure) | 2: shorter titles, less crowding | 4: only PASS; U2 GND flag on SCL label |
| 8 | 4: labels clear, mirror wire orthogonal | 1: pair and mirror; Q3 value crossed | 1: clean pair and mirror | none: all 4 checks FAIL (Q3 base gap) |

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

### tscircuit (Part A setup, then Part B: all eight cases)

Neutral circuits (not counted attempts; they chose the tool-wide settings above):
- `common-emitter` a1: tscircuit's default orientation; C1 overlaps R2 (the layout prints "1 chip overlaps
  detected in final layout: C1 overlaps R2"). Check PASS after fixing the check to join same-named net labels.
- a2: signal net names off. tscircuit then auto-named unnamed traces "Q1_base", "C2_pin1", "C2_pin2"; the drawing
  is no better. Not used.
- a3: all resistors and capacitors horizontal. No overlap warning; readable part values. Keep.
- a4: a3 plus C1/C2 rotation 180. Pixel-identical to a3; rotation has no effect on these symbols. Not used.
- a5: default config with a3's orientations. Same as a3; reference image.
- a6: signal nets as tscircuit `<net>` elements instead of traces. tscircuit left V2[+], R1[2], Q1[B], C2[1],
  J1[1] unrouted; check FAIL. Not used.
- `attiny85` a1: check PASS, but U1's box numbered its shown pins 1-6 (its position in the used set), not the
  ATtiny package numbers. Fixed the converter.
- a2: check PASS; U1 shows PB5/PB3/PB4 as 1/2/3 and VCC/PB0/GND as 8/5/4. Reference image.
- a3: chip box 3.2x2.4; made three large, mostly empty boxes. Not used.

Case 1:
- a1: check PASS. Battery at left with a PWR rail on + and GND on -; R1 horizontal to the LED; the LED cathode
  goes to a GND rail. The three parts and the few wires are clear and the LED symbol is the right way round. B1
  shows only its reference: tscircuit's Battery symbol accepts `voltage` but never draws it, so the 9 V value is
  missing. This is the only attempt. Chosen final.

Case 2:
- a1: check PASS. R1/R2 divider with C1 across R2 at the top, op-amp and load below; the 9 V and GND rails are named
  labels. The GND label box at C1's left plate sits on the wire: at 8x the wire runs into and through the box.
  The VREF label is close to R2's reference but readable.
- a2: check PASS. C1 rotation 180 moves its GND side to the right; the GND label now sits clear to the left of
  the wire, and the C1/VREF/R2 network is readable. VREF text still nearly touches R2's reference, but both are
  legible. Chosen final (fixes the only label-on-wire defect).

Case 3:
- a1: check PASS. Conventional left-to-right flow: V3/V2/V1 with R3/R2/R1 form the input cluster, the op-amp,
  Rf and RL form the output cluster, joined by SUM, OUT and GND labels. The SUM label is vertical and its top
  text sits on the summing wire; the op-amp + input is tied to a boxed GND label at the pin. Chosen final.
- a2: check PASS. U1 rotation 90 produced a byte-identical image to a1: this run predates the constructor fix,
  so the rotation never reached tscircuit.
- a3: check PASS. U1 rotation 90 after the constructor fix: the op-amp points down, R3/V3 sit between it and
  the rest, V2/R2 are pushed to the lower left and V1/R1 to the right. Every net is drawn but the arrangement is
  much harder to read; OUT and SUM labels are vertical.
- a4: check PASS. U1 rotation 180: the op-amp faces left with OUT at the top left and SUM on the right; the
  source cluster is on the right and the op-amp cluster on the left, joined only by SUM/OUT/GND labels. Mirrored
  but readable. Not chosen: the conventional a1 flow is easier to follow.

Case 4:
- a1: check FAIL (n10 LA, n11 HB, n12 LB). J1's LA/HB/LB pins and R2/R3/R4 end in short stubs that do not join.
  Q2 and Q3 are not drawn at all; their places show tscircuit's red "Could not match ports for symbol
  (n_channel_e_mosfet_transistor...)" text. Q1 and Q4 are drawn.
- a2: check FAIL (n12 LB only). J1 `pinSides` puts 1/4 on the left and 2/3/5 on the right, which joins LA and
  HB; LB still ends in a stub at R4. Q2/Q3 still missing, same red text.
- a3: check PASS. R4 rotation 180 joins LB. Q1/Q4 are drawn; Q2 and Q3 are still missing and their red error
  text remains. The GND label at M1 sits on the OUTA wire, and auto net names ("Q1_pin3", "Q2_pin3") add extra
  label boxes.
- a4: check PASS. Q2 rotation 90 makes Q2 draw; Q3 is still missing and its red error text lies across the OUTB
  label. The GND label no longer touches OUTA, but the layout is more tangled and still uses the auto net names.
  Chosen final: one missing symbol instead of two, and no label on a wire.

Case 5:
- a1: check FAIL (n1 3V3). The 3V3 rail is drawn at R1/R2; U1/U2/U3's VIN pins form a separate bus with no 3V3
  label, and the rail stub stops about 0.4 units short of the bus (clear gap at 6x). GND, SDA and SCL pass.
- a2: check FAIL (n1). R2 rotation 180; same 3V3 split and same gap.
- a3: check FAIL (n1). R2 rotation 180; same 3V3 split.
- a4: check FAIL (n1). R2 rotation 180; same 3V3 split. SCL's vertical label at U1 pin 4 is clear of the wire.
  No final: no attempt's check passes.

Case 6:
- a1: check PASS. 5 V and GND rails at the top and bottom; Q1 switches the relay coil and D1 is its flyback
  diode; K1's contacts and J1 LOAD are separate boxes joined by the auto label "K1_COM" between K1.COM and
  J1.COM. The relay box
  shows A1/A2/COM/NO/NC with package numbers 1/2/11/14/12. D1 and Q1 show only their references (no 1N4148 or
  2N2222A), and the "RELAY" net name at U1 pin 1 is small but readable. Chosen final; only attempt.

Case 7:
- a1: check FAIL (5V and GND merged). The GND label at U2's WP pin sits on the 5 V wire, so the check joins the
  two nets. The SCL label is squeezed beside R3 and R2's wire.
- a2: check FAIL (n1 5V). U1/U2 `pinSides`; the 5 V group lacks R2[1] and U2[8]. The SDA label lies on R2's
  "4.7kΩ" value.
- a3: check FAIL (n1 5V). R3 rotation 180; the 5 V group still lacks R2[1] and U2[8], and the SDA label still
  covers R2's value.
- a4: check PASS. R2 rotation 180 completes the 5 V group. U2's WP GND flag is drawn on top of the vertical SCL
  label, so those two texts overlap and neither is fully readable; the capacitor bus is crowded. Chosen final
  (the only passing attempt).

Case 8:
- a1: check FAIL (n6 MIRROR). Q3's base wire ends a hairline short of the base pin; at 8x there is a visible gap
  between the green wire and the dark red pin line, so Q3[B] stays alone. The rest of the pair and mirror is
  drawn.
- a2: check FAIL (n6). Q3 rotation 90 puts the base at the bottom; the base wire still stops short of the pin.
- a3: check FAIL (n6). Q3 rotation 90 after the constructor fix; the layout moves but the base gap remains.
- a4: check FAIL (n6). Q3 rotation 270; the trace endpoint is 0.015 units from the port, the same hairline gap.
  No final: no attempt's check passes.

Finals: cases 1, 2, 3, 4, 6 and 7 have a `final.png` (attempt 1, 2, 1, 4, 1 and 4). Cases 5 and 8 have no
`final.png`: every attempt's check fails, and the brief says a drawing whose check fails cannot be chosen.

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
- tscircuit case 1: B1's "9V" value is not drawn. tscircuit's Battery symbol accepts `voltage` but prints only
  the reference; the same happens to the battery in cases 2 and 4.
- tscircuit case 2: the "VREF" label text and R2's reference nearly touch at the top of the divider. Both are
  readable.
- tscircuit case 3: the SUM net labels are vertical, and the label at the top of the summing wire sits on that
  wire; the sources/resistors and the op-amp/feedback are placed as two separate clusters joined only by net
  labels. These are tscircuit's own layout choices.
- tscircuit case 4: Q3's symbol is not drawn at all. tscircuit prints red "Could not match ports for symbol
  (n_channel_e_mosfet_transistor...)" text where Q3 should be, and that text lies across the OUTB label. The
  layout also uses tscircuit's auto net names ("Q1_pin3", "Q2_pin3") as extra labels. This is a tool failure;
  the check still passes because Q3's ports and traces exist. The MOSFETs and the battery show no part values.
- tscircuit case 6: D1 and Q1 show only their references, not 1N4148 and 2N2222A; tscircuit's diode and
  transistor symbols do not draw a value.
- tscircuit case 7: U2's WP GND flag is drawn on top of the vertical SCL net label, so the two texts overlap and
  neither is fully readable.
- tscircuit case 8: no final (see below); the Q3 base gap would be the main defect if one were chosen.

Tool failures with no final:

- tscircuit case 5: in all four attempts the 3V3 rail is drawn only at R1/R2 and the U1/U2/U3 VIN group never
  gets a 3V3 label; the rail stub also stops about 0.4 units short of the bus. The check fails on n1 3V3.
- tscircuit case 8: in all four attempts Q3's base trace stops 0.015 units short of the base pin (a hairline gap
  at 6x to 8x), so Q3[B] stays out of the MIRROR net. The check fails on n6 MIRROR.

## Note for the judge kit

The judge kit wants `<tool>__caseNN.png` in one folder; copy the `final.png` files that way.
