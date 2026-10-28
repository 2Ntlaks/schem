# Connections in the validation baselines

This file lists, for each validation case, the nets that every baseline drawing must show, and which
attempt was chosen as `final.png` for each tool. It is built from the final attempts' `.check.txt` files.

The check is done per tool in the way that tool represents a drawing. schemdraw's kit rebuilds the
connections from the drawn geometry (pin anchors, wire segments, supply symbols and net labels).
SKiDL writes the netlist that its drawing used and maps it back to the case pin numbers. netlistsvg
reads its own converter output, where power and ground nets become separate symbols that join by
name. Every final check below reports each net as `OK` and ends with `RESULT PASS`.

Unnamed nets have no label and are joined only by drawn wires. Named supply nets may be drawn as
several symbols with the same name; those symbols are one net for a reader.

All 24 finals: schemdraw 8, SKiDL 8, netlistsvg 8, all PASS.

## Case 1: LED and resistor

Circuit file: `phase0/cases/validation/case01-led.json`.

Parts: B1 battery 9V, R1 resistor 470, D1 led red.

| Net | Pins |
| --- | --- |
| PWR | B1[+], R1[1] |
| unnamed (n2) | R1[2], D1[A] |
| GND | D1[K], B1[-] |

Final drawings: schemdraw attempt 3, SKiDL attempt 1, netlistsvg attempt 1. Each final check reports
every net above as OK, so all three results are PASS.

Checks: `out/schemdraw/validation/case01/attempt-3.check.txt`,
`out/skidl/validation/case01/attempt-1.check.txt`,
`out/netlistsvg/validation/case01/attempt-1.check.txt`.

## Case 2: divider and buffer

Circuit file: `phase0/cases/validation/case02-divider-buffer.json`.

Parts: B1 battery 9V, R1 resistor 10k, R2 resistor 10k, C1 capacitor 100n, U1 opamp, RL resistor 10k.

| Net | Pins |
| --- | --- |
| 9V | B1[+], R1[1] |
| VREF | C1[1], R1[2], R2[1], U1[3] |
| VOUT | RL[1], U1[1], U1[2] |
| GND | B1[-], C1[2], R2[2], RL[2] |

Final drawings: schemdraw attempt 3, SKiDL attempt 1, netlistsvg attempt 1. Each final check reports
every net above as OK, so all three results are PASS.

Checks: `out/schemdraw/validation/case02/attempt-3.check.txt`,
`out/skidl/validation/case02/attempt-1.check.txt`,
`out/netlistsvg/validation/case02/attempt-1.check.txt`.

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

Final drawings: schemdraw attempt 1, SKiDL attempt 1, netlistsvg attempt 1. Each final check reports
every net above as OK, so all three results are PASS.

Checks: `out/schemdraw/validation/case03/attempt-1.check.txt`,
`out/skidl/validation/case03/attempt-1.check.txt`,
`out/netlistsvg/validation/case03/attempt-1.check.txt`.

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

Final drawings: schemdraw attempt 4, SKiDL attempt 4, netlistsvg attempt 2. Each final check reports
every net above as OK, so all three results are PASS.

Checks: `out/schemdraw/validation/case04/attempt-4.check.txt`,
`out/skidl/validation/case04/attempt-4.check.txt`,
`out/netlistsvg/validation/case04/attempt-2.check.txt`.

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

Checks: `out/schemdraw/validation/case05/attempt-4.check.txt`,
`out/skidl/validation/case05/attempt-1.check.txt`,
`out/netlistsvg/validation/case05/attempt-1.check.txt`.

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

Final drawings: schemdraw attempt 3, SKiDL attempt 1, netlistsvg attempt 1. Each final check reports
every net above as OK, so all three results are PASS.

Checks: `out/schemdraw/validation/case06/attempt-3.check.txt`,
`out/skidl/validation/case06/attempt-1.check.txt`,
`out/netlistsvg/validation/case06/attempt-1.check.txt`.

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

Final drawings: schemdraw attempt 3, SKiDL attempt 4, netlistsvg attempt 1. Each final check reports
every net above as OK, so all three results are PASS.

Checks: `out/schemdraw/validation/case07/attempt-3.check.txt`,
`out/skidl/validation/case07/attempt-4.check.txt`,
`out/netlistsvg/validation/case07/attempt-1.check.txt`.

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

Final drawings: schemdraw attempt 4, SKiDL attempt 1, netlistsvg attempt 1. Each final check reports
every net above as OK, so all three results are PASS.

Checks: `out/schemdraw/validation/case08/attempt-4.check.txt`,
`out/skidl/validation/case08/attempt-1.check.txt`,
`out/netlistsvg/validation/case08/attempt-1.check.txt`.
