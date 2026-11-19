# Circuits schem recognises

schem draws most circuits by general rules: power at the top, ground at the bottom, signals from
left to right. For some well-known circuits that is not enough. An engineer expects an op-amp
filter or an H-bridge in one particular shape, and a drawing in any other shape is harder to read
even when every connection is right.

For those circuits schem has **templates**. A template is a description of a small circuit (which
parts, connected how) together with the shape it should be drawn in. When part of your circuit
fits a template, that part is drawn in the template's shape, and the rest of the circuit is laid
out around it.

You do not ask for a template. You write the netlist as usual and schem finds the circuits it
knows. Part names do not matter (`R1` or `Rfb` are the same to it), and neither does the order of
a resistor's or capacitor's two pins.

This page lists every template: what schem looks for, and how it draws it. The name in the last
column is the template's id in [`src/layout/templates/library.ts`](../src/layout/templates/library.ts).

## Op-amp amplifiers

| Circuit | What schem looks for | How it is drawn | Id |
|---|---|---|---|
| Inverting or summing amplifier | An op-amp with a resistor from its output to IN-, and one or more resistors into IN- | Inputs come in from the left, one row each, and meet in one column in front of IN-. The feedback resistor runs above the op-amp. | `opamp-inverting` |
| Non-inverting amplifier | An op-amp with a resistor from its output to IN-, and a resistor from IN- to ground | The op-amp is turned so IN+ is on top and the input runs straight in. The feedback resistor lies below, the ground resistor stands under the node. | `opamp-noninverting` |

## Active filters

| Circuit | What schem looks for | How it is drawn | Id |
|---|---|---|---|
| Integrator | An op-amp with a capacitor from its output to IN-, and one or more resistors into IN- | Like the inverting amplifier, with the capacitor above the op-amp. | `opamp-integrator` |
| Inverting low-pass filter | An inverting amplifier with a capacitor across its feedback resistor | Like the inverting amplifier. The capacitor lies above the feedback resistor, centred on it, between the same two columns. | `opamp-inverting-lowpass` |
| Sallen-Key low-pass filter | Two resistors in series into IN+; a capacitor from the point between them to the output; a capacitor from IN+ to ground; the output tied straight to IN- | IN+ on top. The two resistors lie in one line into IN+. The first capacitor arches over them to the output, the second hangs from the IN+ line. The output returns under the op-amp to IN-. | `sallen-key-lowpass` |
| Sallen-Key high-pass filter | The same with the parts swapped: two capacitors in series, a resistor back from the output, a resistor to ground | The same shape. | `sallen-key-highpass` |
| Sallen-Key filter with gain | Either Sallen-Key filter, with a resistor from the output to IN- and a resistor from IN- to ground in place of the straight tie | The same shape, with the two gain resistors below the op-amp as in the non-inverting amplifier. | `sallen-key-lowpass-gain`, `sallen-key-highpass-gain` |

Two Sallen-Key stages in a row (a fourth-order filter) are found as two filters and drawn side by
side: see [`examples/sallen-key-filter.schem.json`](../examples/sallen-key-filter.schem.json).

In a Sallen-Key filter with gain, the part from IN+ to ground and the gain resistor to ground must
end on the same net. If they do not, the op-amp is drawn as a non-inverting amplifier and the
filter parts by the general rules.

## Oscillators

| Circuit | What schem looks for | How it is drawn | Id |
|---|---|---|---|
| Relaxation oscillator | An op-amp with a resistor from its output to IN- and a capacitor from IN- to ground (the timing parts), and a resistor from its output to IN+ and a resistor from IN+ to ground (the divider that sets the switching levels) | The timing resistor runs above the op-amp and the timing capacitor hangs on the left. The divider is below: one resistor lying under the op-amp, the other standing under the IN+ node. | `relaxation-oscillator` |
| Wien bridge oscillator | An op-amp with a resistor and a capacitor in series from its output to IN+, a resistor and a capacitor side by side from IN+ to ground, and the two gain resistors of a non-inverting amplifier | IN+ on top. The series pair runs in one line above the op-amp. The other pair hangs side by side from the IN+ line. The gain resistors are below. | `wien-bridge-rc`, `wien-bridge-cr` |

An oscillator has no input, so schem treats it as the place where the signal starts: whatever its
output drives is drawn to its right. Examples:
[`examples/relaxation-oscillator.schem.json`](../examples/relaxation-oscillator.schem.json) and
[`examples/wien-bridge.schem.json`](../examples/wien-bridge.schem.json).

## Transistor circuits

| Circuit | What schem looks for | How it is drawn | Id |
|---|---|---|---|
| Two-transistor LED oscillator | Two grounded NPN emitters. Each collector connects through a timing capacitor to the opposite base. Each base has a resistor to the positive supply. Each collector connects to that supply through a resistor and then an LED. | The transistors stand side by side with their bases facing inward and their loads above. Follow each capacitor across its own row to the junction dot on the opposite base wire. | `npn-led-astable` |
| H-bridge | Four transistors in two legs between one supply and ground, P-type on the high side and N-type on the low side (MOSFETs or BJTs), with a load between the two leg midpoints | Two vertical legs side by side, high side above low side, the load lying between the midpoints. Gate or base resistors face outward. | `h-bridge-pmos-nmos`, `h-bridge-pnp-npn` |
| Differential pair | Two transistors sharing a tail resistor, with a current mirror of the opposite type as their load | Two vertical legs, the mirror on top, the pair below, the tail resistor centred under the pair. Inputs face outward. | `diff-pair-npn-pnp-mirror`, `diff-pair-nmos-pmos-mirror` |
| Low-side switch | An NPN transistor or N-channel MOSFET with its emitter or source on ground and a load (a relay coil, motor, resistor) from its collector or drain to the supply | The load above the transistor on one vertical line. The base or gate resistor lies on the left; a flyback diode stands beside the load. | `low-side-npn-relay`, `low-side-nmos-relay`, `low-side-npn-two-pin`, `low-side-nmos-two-pin` |

## Power, buses and small parts

| Circuit | What schem looks for | How it is drawn | Id |
|---|---|---|---|
| Bridge rectifier | Four diodes forming a full bridge | Two vertical diode legs side by side, AC in from the left at the midpoints, + on top. | `bridge-rectifier` |
| I2C bus with pull-ups | Two nets whose pins carry the `i2c.sda` and `i2c.scl` roles, with a resistor from each to one supply | The controller on the left, SDA above SCL as two straight lines, the pull-ups just above them, the other chips in a row below. | `i2c-pullups` |
| Voltage divider | Two resistors in series between a supply and ground, with something connected to the point between them | One vertical column, the tap between the resistors. | `voltage-divider` |
| Pull-up, pull-down | A resistor from a signal to a supply or to ground | Vertical, from the supply or ground symbol to the signal wire. | `pull-up`, `pull-down` |
| LED with its resistor | A resistor in series with an LED | In one line, the resistor first. Vertical when the LED goes to ground. | `led-series-vertical`, `led-series` |

Decoupling capacitors are handled separately: a capacitor between a chip's supply pin and ground is
drawn standing next to that pin.

## When two templates fit

A part belongs to one template at most. When two templates want the same part, the one earlier in
this order wins: op-amp stages and filters, then transistor circuits, the bridge rectifier, the
I2C bus, the low-side switch, and last the small ones (divider, pull-up, LED). Between two of the
same rank, the one that covers more parts wins. That is why a Sallen-Key filter with gain is drawn
as one filter and not as a non-inverting amplifier with loose parts around it.

## What is not here yet

These have no template. The general rules ([`general-layout.md`](general-layout.md)) draw them:

- Single-transistor amplifiers (common emitter, emitter follower) and 555 timer circuits come out
  close to their textbook shape: the general rules stack a transistor's load above it and its
  emitter parts below, and stand a timing string in one column.
- A differentiator, Sallen-Key band-pass filters and multiple-feedback filters are drawn in signal
  order, but not in a fixed shape.
- Symmetric circuits (an instrumentation amplifier, a push-pull output
  stage) are drawn left to right, valid but not in the shape an engineer expects. These are the
  best candidates for new templates.

If a circuit you draw often is missing, open an issue with the circuit file and a picture of the
shape you expect. A template is data, not code: see the notes at the top of
[`src/layout/templates/types.ts`](../src/layout/templates/types.ts).
