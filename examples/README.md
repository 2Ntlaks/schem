# Example circuits

Five circuit files to try the engine with. Each one is in the official `schem/1.0` form described in
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

All five should print `valid` and exit with code 0.
