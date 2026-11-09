# Example circuits

Eight circuit files to try the engine with. Each one is in the official `schem/1.0` form described in
`docs/netlist-format.md`.

Draw one with:

```
npm run schem -- draw examples/led.schem.json
```

The drawing is written to `out/led.svg` and `out/led.png`. Use `-o <dir>` to write somewhere else.

| File | Circuit | What it shows |
|---|---|---|
| `led.schem.json` | LED with a current-limiting resistor | The smallest complete circuit: a battery, a resistor and an LED, with a named power net and a named ground net. |
| `summing-amp.schem.json` | Inverting summing amplifier | An op-amp with three input resistors and feedback, plus a load resistor. |
| `h-bridge.schem.json` | H-bridge motor driver | Four MOSFETs around a motor, gate resistors and a drive header. |
| `i2c-sensors.schem.json` | ESP32 with two I2C sensors | Two `ic` parts with their own pin lists sharing SDA and SCL pull-ups. |
| `esp32-relay.schem.json` | ESP32 relay driver | A `module:` part (the ESP32 board), an NPN transistor, a relay and a flyback diode. |
| `sallen-key-filter.schem.json` | Fourth-order low-pass filter | Two Sallen-Key filter stages in a row. Each is recognised and drawn in its textbook shape. |
| `wien-bridge.schem.json` | Wien bridge oscillator | A circuit with no input: the oscillator is drawn first and its output connector to its right. |
| `relaxation-oscillator.schem.json` | Relaxation oscillator | An op-amp with feedback to both inputs: timing parts above, the threshold divider below. |

All eight should print `valid` and exit with code 0.

The last three are drawn the way they are because schem recognises them:
[`docs/templates.md`](../docs/templates.md) lists every circuit it knows.
