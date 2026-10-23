# Author notes: spec gaps met while freezing the Phase 0b cases

Agent B, 2026-10-23, against SPEC rev C.2. Each item gives what was unclear, what the cases do, and what Phase 0b (agent A) or the spec should decide. Items marked **spec** are proposals to fold into SPEC.md; items marked **0b** are things the engine must grow to read these files.

After the freeze no file under `cases/` changes. A correction goes into a **new** file (for example `cases/validation/case05-i2c.r2.json`) with a note added here, and `MANIFEST.sha256` is extended, not rewritten.

## File format

1. **Two file shapes (0b).** Cases 1, 3 and 5 are byte-for-byte copies of the Phase 0a cases (`meta` + `circuit`, endpoints in name form such as `R1.1`). The other nine use the SPEC 6.5 project shape: `schema`, `meta` (title, created, `nextNetId`, `nextHintId`), `circuit` (endpoints in canonical form `R1[1]`, sorted canonically), `intent`, `assets` and `ext`. There is no `layout` (it is a cache). The Phase 0b loader must read both shapes, or the three old files get upgraded copies as new files.
2. **`assets` holds only the module definitions (0b, spec).** SPEC 6.5 says `assets.definitions` holds every definition used and is written by the engine. Built-in symbols are not embedded here, because their definitions belong to the engine. `assets.library` is `"schem-symbols@phase0b-proposal"` to mark that. The engine should fill in the built-in definitions on first save.
3. **Where provenance goes.** Module documentation (URL, revision, date retrieved, numbering rule) lives in each module definition's `doc` field (SPEC 7.3 says modules carry it). Datasheet references for `ic` chips are in `ext.phase0.pinSources`, not `props`, because `props` may be displayed. `ext.phase0` also records the case number, set and a one-line description of the circuit.

## Modules (SPEC 7.3)

4. **Module definition shape (spec).** SPEC 7.1 defines symbols with geometry; SPEC 7.3 lists what a module carries but gives no shape. The cases use `{ id, version, kind: "module", name, refPrefix, controller, doc: { title, url, revision, retrieved, pinNumbering, notes }, pins: [ { number, name, role, aliases?, group?, iface? } ] }`. There is no geometry: a module is drawn as a generated box, like `ic`.
5. **Pin numbers follow the documentation, not the SPEC 7.3 example.** The SPEC 7.3 example numbers ESP32 pins 1-38 with GND at 14, 29 and 38. The Espressif guide numbers each header separately, and GND is J2-14, J3-1 and J3-7. The cases use `J2-1` ... `J3-19`. The Uno uses `JA-n` (JANALOG), `JD-n` (JDIGITAL), `ICSP-n` and `ICSP1-n`, as in Arduino's datasheet and pinout. Where the documentation names pins without numbers (Waveshare LCD1602 I2C, Pololu D24V10F5), pins are numbered 1..N in the order the documentation lists them, and `doc.pinNumbering` says so. `-` in a pin number is allowed by the PINNUMBER token (SPEC 8.1).
6. **Board supply pins change direction (spec).** Whether a board's 5V pin is an input or an output depends on how the board is powered. Roles are fixed per module: ESP32 `3V3` is `power_out` (regulator output) and `5V` is `power_in`; Uno `VIN` is `power_in`, and `+5V`, `+3V3` and `IOREF` are `power_out`. In case 6 the USB-powered ESP32's `5V` pin also feeds the relay coil, so its `power_in` role is a slight misfit. Only the unconnected-supply warning depends on it. A `power_bidir` role, or a per-part role override, would remove the misfit.
7. **No interface roles on the ESP32.** Any ESP32 GPIO can carry I2C through the GPIO matrix, so the board documentation assigns none. An I2C bus is still recognised through the peripherals' pins (SPEC 9.2 step 2.5 needs only one endpoint with the role). Case 5, copied from Phase 0a, also puts `i2c.*` roles on its controller's inline pins.
8. **Uno groups.** The datasheet says the JDIGITAL 17/18 pins duplicate A4/A5 and IOREF is connected to 5V; the pinout shows the ICSP pins on D11-D13, RESET, 5V and GND. These are groups (`A4_SDA`, `A5_SCL`, `5V`, `GND`, `RESET`, `D11_COPI`, `D12_CIPO`, `D13_SCK`). Aliases are unique within the part, so the digital numbers D14-D19 sit on A0-A5 only. The ATmega16U2's ICSP1 signal pins are ungrouped, so `A1.SCK`, `A1.COPI`, `A1.CIPO` and `A1.RESET` are ambiguous by name (E106); agents must write the pin number (`A1[JD-14]`). That is the SPEC 6.2 rule working as intended.
9. **Group representative can land on an odd pin (spec).** The representative of a group is its lowest pin number in natural order (SPEC 6.2). For the Uno's GND group that is `ICSP1-6`, the USB chip's programming header (checked with `groupRepresentative`). A ground symbol drawn there would look wrong to anyone who wires the board, so a case using the Uno connects a physical GND pin instead, as SPEC D1 allows. The ESP32 cases use the group endpoint `U1{GND}`, whose representative is `J2-14`, a real header GND. Suggestion: let a module definition order its group members, or name a preferred representative.
10. **Case 5 (copied) does not carry real board pin numbers.** Its ESP32 is an `ic` with pins 1-4 (3V3, GND, GPIO21, GPIO22). On a DevKitC V4 these are J2-1, J2-14 (or another GND), J3-6 and J3-3. The BME280 and SHT31 breakouts are numbered 1-4 too. The brief asked for a byte-for-byte copy, so the file is unchanged. Its controller's 3V3 pin is also `power_in`, so its 3V3 net has no source pin (the module file has `power_out`). If real numbers are wanted for case 5, add a new file rather than editing it.

## Symbols not in `src/symbols/library.ts` (0b)

11. **Proposed pin inventories.** The cases use 14 SPEC 7.2 types that the library does not have yet. Their pin numbers, names, aliases, roles and `chain` directions are written down in `proposed-symbols.json`, which `check-cases.ts` uses to resolve endpoints:

    | Type id | Pins (number: name) |
    |---|---|
    | `polarised-capacitor` | `+`, `-` (aliases pos/p, neg/n; chain + in, as SPEC 8.3) |
    | `potentiometer` | `1`, `3` track ends, `2` wiper (alias `W`), the usual datasheet and KiCad numbering |
    | `diode` | `A` anode, `K` cathode (as the built-in `led`, but without the numeric aliases: in common libraries diode pin 1 is the cathode, while the built-in `led` has alias `1` = anode; agent A may want to drop that alias) |
    | `npn`, `pnp` | `B` base, `C` collector, `E` emitter |
    | `nmos`, `pmos` | `G` gate, `D` drain, `S` source |
    | `spst`, `pushbutton`, `fuse` | `1`, `2` |
    | `buzzer` | `+`, `-` (active buzzers are polarised) |
    | `motor` | `1`, `2` |
    | `relay` | `A1`, `A2` coil; `11` COM, `12` NC, `14` NO (EN 50005 terminal numbers) |
    | `ac-source` | `1`, `2` |
    | `header` | per part, see item 13 |

    Type ids follow the SPEC 7.2 names. `polarised-capacitor` uses the spec's spelling, and `src/core/quantity.ts` accepts both spellings.
12. **Discrete semiconductors use symbol pins, not package pins.** SPEC D1 keeps real pin identity for boards and chips. For transistors, MOSFETs and diodes the cases use symbol letters (B/C/E, G/D/S, A/K) and record the part in `props.partNumber`, because package pinouts differ between makers (TO-92 EBC or CBE) and the symbol is what readers expect. If Phase 0b wants package numbers, they belong in the symbol definition as aliases.
13. **Header connectors carry their own pins (spec).** SPEC 6.2 allows `pins` only on `ic` and custom parts. A header's pin count and names change per instance (`DRIVE`: HA, LA, HB, LB, GND), so each `header` part has inline `pins`, like `ic`. The spec should either allow `pins` on `header`, or say that a header is a custom part.
14. **Two-terminal sources and switches have no pin roles beyond `passive`.** The spec does not give roles for these symbols. All proposed pins are `passive`.

## Intent and hints (SPEC 6.4)

15. **JSON shape of a `decouples` hint (spec).** SPEC 6.4 gives only the DSL form (`hint C3 decouples U1.VCC`). Case 7 uses `{ "id": "h1", "type": "decouples", "part": "C1", "pin": "U1[7]", "priority": "normal" }`, with `pin` a canonical terminal. `check-cases.ts` checks that the pin is `power_in` and that the capacitor sits between that pin's net and a ground net.
16. **Hints only where SPEC 15 allows them.** Only case 7 has hints. No case has flow hints, so cases with no source part depend on the `controller` flag for ranks. Case 7's ATmega328P is an `ic`, so it carries `props.controller: "true"`, as case 5 does. SPEC 9.2 step 2 names only `controller` *modules*; it should say whether `props.controller` on an `ic` counts.
17. **Two capacitors on one pin.** Case 7's EEPROM has 100 nF and 10 uF on its single VCC pin (hints h3 and h4 both name `U2[8]`). The ATmega's two capacitors are on two different pins (VCC 7, AVCC 20). So "each IC with 2 decoupling capacitors" covers both kinds of slot. SPEC 9.4 should say how two capacitors share one pin's decoupling slot (both next to the pin; the smaller nearest).

## Edit scripts (SPEC 11.3, 15)

18. **Edit file shape (spec).** SPEC 11.4 has `schem edit <file> --ops ops.json` but no shape for `ops.json`. Each script is `{ schema: "schem-edit/phase0b", case, edit, description, ops: [...], expect: { ok, affectedParts } }`; the engine's input is the `ops` array.
19. **"3 times longer" texts are not parseable values.** SPEC 12.1 renders values "with proper symbols" (`4.7 kΩ`), so a parseable longer value might be redrawn shorter. Each new value is a realistic annotation that does **not** parse as a quantity (`20k ±0.1%`, `4.7k 1% 0603`, `100n X7R 50V`, `10k 1/4 W`). It is therefore displayed as written (W320), and the label really grows to exactly 3 times the old length in code points. `check-cases.ts` checks the length.
20. **`setPinSides` order and unnamed pins (spec).** The cases assume that each list runs top to bottom (left and right sides) or left to right (top and bottom), and that pins not listed keep their default placement. SPEC 11.3 says neither.
21. **Case 3's "IC" is the op-amp, a fixed symbol (open question).** The only IC in case 3 is the built-in 3-pin op-amp. Its script asks for IN+ above IN- (`left: [U1[3], U1[2]]`). A fixed symbol can only do that by a vertical mirror, so the engine may implement the request as a flip, or reject it with D4's "undo and explain". Either outcome is a legitimate result for gate 4, so that script has `expect.ok: "either"` (all others `true`). Agent A or the owner may rule on it.
22. **`removePart` and hints that name the part (spec).** SPEC 9.5 and 11.3 do not say what happens to a hint that names a removed part. Case 7's removal script removes hint `h4` first (`removeHint`), then the capacitor, in one transaction. The spec should define the behaviour: reject, or drop the hint with a finding.
23. **The affected-parts table makes almost everything "affected" (spec, gate 4).** In SPEC 9.5, `addPart` and `removePart` affect "parts on the nets it joins/was on". A part on GND or a supply net therefore affects every part on that net, even though those nets are drawn as ports. Case 7's add-part script (a capacitor from RESET to GND) affects 9 of its 11 parts and leaves 2 untouched; the larger the case, the worse this gets. Gate 4's displacement limits are therefore tested on very few parts. Suggestion: leave port-drawn power and ground nets out of "nets it joins" for the affected-parts rule. The `expect.affectedParts` lists follow the table as written; `check-cases.ts` recomputes and compares them.
24. **`setProp` (11.3).** At HEAD, `src/core/ops.ts` has no `setProp`. Agent A's working copy adds one. `check-cases.ts` uses src/core's `setProp` when it exists, and otherwise sets the property itself and says so.

## Circuits

25. **Negative supply names (spec).** SPEC 6.3's default power names do not include negative rails (`-12V`, `VEE`). Case 8 sets `kind: "power"` on `+12V` and `-12V` explicitly.
26. **Single-endpoint supply nets (spec).** SPEC 9.7 draws a one-endpoint net as an unconnected pin, but a supply port on one pin (a lone `-12V` symbol on a tail resistor) is normal drafting. No case has a one-endpoint net: case 8 includes its ±12 V sources. The spec should say whether a one-endpoint power net may be drawn as a port.
27. **Case 8 values.** 1 mV input and a 10k load keep the output in range: about 1 mA tail current, gm about 20 mS per side, gain about 200 (with 100k and 10 mV the stage would clip). An independent review flagged the first values.
28. **Case 2 and case 3 use the 3-pin op-amp** (supplies implied, as in textbook figures). The 5-pin op-amp of SPEC 7.2 is not used by any case.
29. **Case 4's gate drive** assumes inputs that swing to the 12 V rail (the P-MOSFETs need it). A logic-level design would add level shifters, which SPEC 15's "4 MOSFETs, motor, gate resistors" does not include.
30. **Test-set notes** (cases 9-12) are in `cases/test/NOTES.md`, so this file can be read before the end gate.
