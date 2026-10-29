# Connections in the validation baselines

This file lists, for each validation case, the nets that every baseline drawing must show, and which
attempt was chosen as `final.png` for each tool. It is built from the final attempts' `.check.txt` files.

The check is done per tool in the way that tool represents a drawing. schemdraw's kit rebuilds the
connections from the drawn geometry (pin anchors, wire segments, supply symbols and net labels).
SKiDL writes the netlist that its drawing used and maps it back to the case pin numbers. netlistsvg
reads its own converter output, where power and ground nets become separate symbols that join by
name. tscircuit reads the schematic part of its circuit JSON: schematic ports, schematic traces and
schematic net labels, with same-named labels joined (tscircuit ends a short wire at a named label
rather than routing a long wire). Its check counts two drawn things as touching when the true distance
between them is less than the drawn wire width, 0.02 schematic units, using point-to-point distance for
pins and wire ends and point-to-segment distance for a pin, junction or label anchor on a wire. Every
final check below reports each net as `OK` and ends with `RESULT PASS`.

Unnamed nets have no label and are joined only by drawn wires. Named supply nets may be drawn as
several symbols with the same name; those symbols are one net for a reader.

All 24 finals of the first three tools: schemdraw 8, SKiDL 8, netlistsvg 8, all PASS. tscircuit has finals for
six of the eight cases, so there are 30 finals in all. Its checks PASS for cases 1, 2, 3, 4, 6 and 8. Cases 5
and 7 have no tscircuit final because every attempt's check fails; those failures are described under those
cases and in `LOG.md`.

For tscircuit, a net is sometimes drawn as two or more groups joined only by same-named labels rather than by a
wire. The notes under each case list those nets; the check joins them by label name, which is tscircuit's own
schematic convention.

## Case 1: LED and resistor

Circuit file: `phase0/cases/validation/case01-led.json`.

Parts: B1 battery 9V, R1 resistor 470, D1 led red.

| Net | Pins |
| --- | --- |
| PWR | B1[+], R1[1] |
| unnamed (n2) | R1[2], D1[A] |
| GND | D1[K], B1[-] |

Final drawings: schemdraw attempt 3, SKiDL attempt 1, netlistsvg attempt 2, tscircuit attempt 1. Each final
check reports every net above as OK, so all four results are PASS.

tscircuit joins GND only by name: D1[K] and B1[-] are separate wire groups with the same-named GND rail. PWR
and the LED net are drawn as wires.

Checks: `out/schemdraw/validation/case01/attempt-3.check.txt`,
`out/skidl/validation/case01/attempt-1.check.txt`,
`out/netlistsvg/validation/case01/attempt-2.check.txt`,
`out/tscircuit/validation/case01/attempt-1.check.txt`.

## Case 2: divider and buffer

Circuit file: `phase0/cases/validation/case02-divider-buffer.json`.

Parts: B1 battery 9V, R1 resistor 10k, R2 resistor 10k, C1 capacitor 100n, U1 opamp, RL resistor 10k.

| Net | Pins |
| --- | --- |
| 9V | B1[+], R1[1] |
| VREF | C1[1], R1[2], R2[1], U1[3] |
| VOUT | RL[1], U1[1], U1[2] |
| GND | B1[-], C1[2], R2[2], RL[2] |

Final drawings: schemdraw attempt 3, SKiDL attempt 1, netlistsvg attempt 1, tscircuit attempt 2. Each final
check reports every net above as OK, so all four results are PASS.

tscircuit joins 9V, VOUT and GND only by name: B1[+] and R1[1] carry 9V labels; RL[1]/U1[1] and U1[2] carry
VOUT labels; B1[-]/RL[2] and C1[2]/R2[2] carry GND labels. VREF is drawn as wires.

Checks: `out/schemdraw/validation/case02/attempt-3.check.txt`,
`out/skidl/validation/case02/attempt-1.check.txt`,
`out/netlistsvg/validation/case02/attempt-1.check.txt`,
`out/tscircuit/validation/case02/attempt-2.check.txt`.

## Case 3: op-amp summing amplifier

Circuit file: `phase0/cases/validation/case03-summing.json`.

Parts: V1 vsource 1V, V2 vsource 0.5V, V3 vsource 0.2V, R1 resistor 10k, R2 resistor 10k,
R3 resistor 10k, Rf resistor 20k, U1 opamp, RL resistor 2k2.

| Net | Pins |
| --- | --- |
| unnamed (n1) | V1[+], R1[1] |
| unnamed (n2) | V2[+], R2[1] |
| unnamed (n3) | V3[+], R3[1] |
| SUM | R1[2], R2[2], R3[2], U1[2], Rf[1] |
| OUT | U1[1], Rf[2], RL[1] |
| GND | V1[-], V2[-], V3[-], U1[3], RL[2] |

Final drawings: schemdraw attempt 1, SKiDL attempt 1, netlistsvg attempt 1, tscircuit attempt 4. Each final
check reports every net above as OK, so all four results are PASS.

tscricuit joins GND only by name: the three source returns (V1[-]/V2[-]/V3[-], with the GND label at the bottom
of the sources) and RL[2] with U1[3] (the GND label beside RL) are two wire groups with the same-named GND
label. SUM, OUT and the three source input nets are drawn as wires. The GND lead under the op-amp in attempts 1
and 2 is 0.031 units from the SUM wire but is not connected: the SUM wire hops over the GND wire and the label
lead points away from it.

Checks: `out/schemdraw/validation/case03/attempt-1.check.txt`,
`out/skidl/validation/case03/attempt-1.check.txt`,
`out/netlistsvg/validation/case03/attempt-1.check.txt`,
`out/tscircuit/validation/case03/attempt-4.check.txt`.

## Case 4: H-bridge motor driver

Circuit file: `phase0/cases/validation/case04-hbridge.json`.

Parts: B1 battery 12V, Q1 pmos IRF9540N, Q2 nmos IRF540N, Q3 pmos IRF9540N, Q4 nmos IRF540N,
M1 motor 12 V DC motor, R1 resistor 100, R2 resistor 100, R3 resistor 100, R4 resistor 100,
R5 resistor 10k, R6 resistor 10k, R7 resistor 10k, R8 resistor 10k, J1 header DRIVE.

| Net | Pins |
| --- | --- |
| 12V | B1[+], Q1[S], Q3[S], R5[1], R7[1] |
| GND | B1[-], J1[5], Q2[S], Q4[S], R6[2], R8[2] |
| OUTA | M1[1], Q1[D], Q2[D] |
| OUTB | M1[2], Q3[D], Q4[D] |
| unnamed (n5) | Q1[G], R1[2], R5[2] |
| unnamed (n6) | Q2[G], R2[2], R6[1] |
| unnamed (n7) | Q3[G], R3[2], R7[2] |
| unnamed (n8) | Q4[G], R4[2], R8[1] |
| HA | J1[1], R1[1] |
| LA | J1[2], R2[1] |
| HB | J1[3], R3[1] |
| LB | J1[4], R4[1] |

Final drawings: schemdraw attempt 4, SKiDL attempt 4, netlistsvg attempt 2, tscircuit attempt 4. Each final
check reports every net above as OK, so all four results are PASS.

tscircuit joins 12V, GND, OUTA and OUTB only by name. 12V is in three groups (B1[+]; Q1[S]/Q3[S];
R5[1]/R7[1]) and GND in four (B1[-]/Q2[S]; J1[5]; Q4[S]; R6[2]/R8[2]) with same-named rails. OUTA is M1[1]
against Q1[D]/Q2[D], and OUTB is M1[2] against Q3[D]/Q4[D], each pair joined by its label. The four unnamed
gate nets (n5-n8) are each split into two groups joined by tscircuit's auto labels "Q1_pin3" to "Q4_pin3";
those texts are not case net names.

Checks: `out/schemdraw/validation/case04/attempt-4.check.txt`,
`out/skidl/validation/case04/attempt-4.check.txt`,
`out/netlistsvg/validation/case04/attempt-2.check.txt`,
`out/tscircuit/validation/case04/attempt-4.check.txt`.

## Case 5: I2C sensors

Circuit file: `phase0/cases/validation/case05-i2c.json`.

Parts: U1 ic ESP32-DevKitC, U2 ic BME280, U3 ic SHT31, R1 resistor 4.7k, R2 resistor 4.7k.

| Net | Pins |
| --- | --- |
| 3V3 | U1[1], U2[1], U3[1], R1[1], R2[1] |
| GND | U1[2], U2[2], U3[2] |
| SDA | U1[3], U2[4], U3[4], R1[2] |
| SCL | U1[4], U2[3], U3[3], R2[2] |

Final drawings: schemdraw attempt 4, SKiDL attempt 1, netlistsvg attempt 1. Each final check reports
every net above as OK, so all three results are PASS.

tscircuit has no final for this case. All four attempts fail n1 3V3: the 3V3 rail is drawn only at R1/R2, with
three label symbols on that group, and the U1[1]/U2[1]/U3[1] group has no 3V3 label and no wire to R1/R2. The
rail stub also stops about 0.4 units short of the U1/U2/U3 bus. GND, SDA and SCL pass in all four attempts.

Checks: `out/schemdraw/validation/case05/attempt-4.check.txt`,
`out/skidl/validation/case05/attempt-1.check.txt`,
`out/netlistsvg/validation/case05/attempt-1.check.txt`,
`out/tscircuit/validation/case05/attempt-4.check.txt` (FAIL).

## Case 6: ESP32 relay driver

Circuit file: `phase0/cases/validation/case06-esp32-relay.json`.

Parts: U1 module:esp32-devkitc-v4, R1 resistor 1k, R2 resistor 10k, Q1 npn 2N2222A,
D1 diode 1N4148, K1 relay SRD-05VDC-SL-C, J1 header LOAD.

| Net | Pins |
| --- | --- |
| 5V | D1[K], K1[A1], U1[J2-19] |
| GND | Q1[E], R2[2], U1[J2-14] |
| RELAY | R1[1], U1[J2-10] |
| unnamed (n4) | Q1[B], R1[2], R2[1] |
| unnamed (n5) | D1[A], K1[A2], Q1[C] |
| unnamed (n6) | J1[1], K1[11] |
| unnamed (n7) | J1[2], K1[14] |
| unnamed (n8) | J1[3], K1[12] |

Final drawings: schemdraw attempt 4, SKiDL attempt 1, netlistsvg attempt 4, tscircuit attempt 1. Each final
check reports every net above as OK, so all four results are PASS.

tscircuit joins 5V and GND only by name: 5V is in three groups (D1[K]; K1[A1]; U1[J2-19]) and GND in three
(Q1[E]; R2[2]; U1[J2-14]) with same-named rails. The unnamed base net (n4) is split into two groups joined by
the auto label "Q1_base", and the relay common net (n6) into two groups joined by "K1_COM". The relay contact
nets n7 and n8 are drawn as wires.

Checks: `out/schemdraw/validation/case06/attempt-4.check.txt`,
`out/skidl/validation/case06/attempt-1.check.txt`,
`out/netlistsvg/validation/case06/attempt-4.check.txt`,
`out/tscircuit/validation/case06/attempt-1.check.txt`.

## Case 7: two ICs with decoupling

Circuit file: `phase0/cases/validation/case07-two-ic-decoupling.json`.

Parts: J1 header 5V IN, U1 ic ATMEGA328P-PU, U2 ic 24LC256-I/P, C1 capacitor 100n,
C2 capacitor 100n, C3 capacitor 100n, C4 capacitor 10u, R1 resistor 10k, R2 resistor 4.7k,
R3 resistor 4.7k.

| Net | Pins |
| --- | --- |
| 5V | C1[1], C2[1], C3[1], C4[1], J1[1], R1[1], R2[1], R3[1], U1[7], U1[20], U2[8] |
| GND | C1[2], C2[2], C3[2], C4[2], J1[2], U1[8], U1[22], U2[1], U2[2], U2[3], U2[4], U2[7] |
| RESET | R1[2], U1[1] |
| SDA | R2[2], U1[27], U2[5] |
| SCL | R3[2], U1[28], U2[6] |

Final drawings: schemdraw attempt 4, SKiDL attempt 4, netlistsvg attempt 2. Each final check reports
every net above as OK, so all three results are PASS.

SKiDL case 7 is a tool failure: the passives are stacked behind U1, so only the two ICs are visible. The
attempt is kept as the tool's honest final, and its check still PASS.

tscircuit has no final for this case. Under the 0.02-unit touch rule, the most readable attempt (a4) joins 5V
and GND: the GND rail from C1[2] to C2[2] is drawn straight through C2[1]'s pin at (-2.510, 3.562), so the pin
lands on the middle of that wire. At 8x the green wire is visible between the capacitor plates. The other three
attempts fail for other reasons: a1 puts the GND label at U2's WP pin on the 5 V wire, and a2/a3 leave the 5 V
group without R2[1] and U2[8]. a4 also draws U2's WP GND flag on top of the SCL label.

Checks: `out/schemdraw/validation/case07/attempt-4.check.txt`,
`out/skidl/validation/case07/attempt-4.check.txt`,
`out/netlistsvg/validation/case07/attempt-2.check.txt`,
`out/tscircuit/validation/case07/attempt-4.check.txt` (FAIL).

## Case 8: differential pair

Circuit file: `phase0/cases/validation/case08-diffpair.json`.

Parts: V1 vsource 1mV, V2 vsource 12V, V3 vsource 12V, Q1 npn 2N3904, Q2 npn 2N3904,
Q3 pnp 2N3906, Q4 pnp 2N3906, RE resistor 11k, RL resistor 10k.

| Net | Pins |
| --- | --- |
| +12V | Q3[E], Q4[E], V2[+] |
| -12V | RE[2], V3[-] |
| GND | Q2[B], RL[2], V1[-], V2[-], V3[+] |
| IN | Q1[B], V1[+] |
| TAIL | Q1[E], Q2[E], RE[1] |
| MIRROR | Q1[C], Q3[B], Q3[C], Q4[B] |
| OUT | Q2[C], Q4[C], RL[1] |

Final drawings: schemdraw attempt 4, SKiDL attempt 1, netlistsvg attempt 1, tscircuit attempt 4. Each final
check reports every net above as OK, so all four results are PASS.

tscircuit joins +12V, -12V and GND only by name, with same-named rails. MIRROR is drawn as wires: the base
trace to Q3 ends 0.015 units from the base pin, which is thinner than the 0.02-unit wire, so the check counts
it as touching and Q3[B] is in the group. IN, TAIL and OUT are also drawn as wires, and the +12V rail at RL and
the Q2 collector wire use hops to show the crossings that are not connected.

Checks: `out/schemdraw/validation/case08/attempt-4.check.txt`,
`out/skidl/validation/case08/attempt-1.check.txt`,
`out/netlistsvg/validation/case08/attempt-1.check.txt`,
`out/tscircuit/validation/case08/attempt-4.check.txt`.
