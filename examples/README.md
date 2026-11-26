# Example circuits

Twelve circuit files to try the engine with: four text schematics in the `.schem` format ([`docs/dsl.md`](../docs/dsl.md)) and eight JSON netlists in the `schem/1.0` format ([`docs/netlist-format.md`](../docs/netlist-format.md)).

Draw any example with:

```sh
npm run schem -- draw examples/led.schem
npm run schem -- draw examples/summing-amp.schem.json --theme dark
```

`draw` writes `<name>.svg` and `<name>.png` to `out/`. Add `-o <dir>` to write somewhere else, `--theme <name>` (`clean`, `dark`, `blueprint`, `textbook`, `mono-print`; see [`docs/themes.md`](../docs/themes.md)) to pick a colour palette, or `--transparent` to omit the background. To redraw SVG and PNG automatically whenever you save changes, use `watch`:

```sh
npm run schem -- watch examples/pico-i2c-oled.schem
```

To create a fresh starter file of your own instead of copying an example, run `init` with a template (`led`, `divider`, `opamp`, `regulator`, `i2c`, or `bjt-amp`):

```sh
npm run schem -- init circuit.schem --template led
```

## Text schematic examples (`.schem`)

Four examples in the text format described in [`docs/dsl.md`](../docs/dsl.md):

```sh
npm run schem -- draw examples/pico-i2c-oled.schem
```

| File | Circuit | What it shows |
|---|---|---|
| [`led.schem`](led.schem) | LED with a current-limiting resistor | The same starter circuit as `led.schem.json`, written in text. |
| [`pico-i2c-oled.schem`](pico-i2c-oled.schem) | Raspberry Pi Pico with SSD1306 OLED | `module:raspberry-pi-pico` driving `module:ssd1306-oled-i2c` over I2C with 4.7k pull-ups and a status LED. |
| [`lm7805-supply.schem`](lm7805-supply.schem) | LM7805 5V linear power supply | `module:lm7805` with reverse-polarity protection, bypass capacitors, power LED and layout hints. |
| [`nano-bme280.schem`](nano-bme280.schem) | Arduino Nano with Adafruit BME280 | `module:arduino-nano` reading `module:adafruit-bme280` over I2C (A4/A5) with 4.7k pull-ups and a status LED. |

All four print `valid` and exit with code 0.

## JSON netlist examples (`.schem.json`)

Eight examples in the `schem/1.0` JSON format described in [`docs/netlist-format.md`](../docs/netlist-format.md):

```sh
npm run schem -- draw examples/esp32-relay.schem.json
```

| File | Circuit | What it shows |
|---|---|---|
| [`led.schem.json`](led.schem.json) | LED with a current-limiting resistor | The smallest complete circuit: a battery, a resistor and an LED, with a named power net and a named ground net. |
| [`summing-amp.schem.json`](summing-amp.schem.json) | Inverting summing amplifier | An op-amp with three input resistors and feedback, plus a load resistor. |
| [`h-bridge.schem.json`](h-bridge.schem.json) | H-bridge motor driver | Four MOSFETs around a motor, gate resistors and a drive header. |
| [`i2c-sensors.schem.json`](i2c-sensors.schem.json) | ESP32 with two I2C sensors | Two `ic` parts with their own pin lists sharing SDA and SCL pull-ups. |
| [`esp32-relay.schem.json`](esp32-relay.schem.json) | ESP32 relay driver | A `module:` part (the ESP32 board), an NPN transistor, a relay and a flyback diode. |
| [`sallen-key-filter.schem.json`](sallen-key-filter.schem.json) | Fourth-order low-pass filter | Two Sallen-Key filter stages in a row. Each is recognised and drawn in its textbook shape. |
| [`wien-bridge.schem.json`](wien-bridge.schem.json) | Wien bridge oscillator | A circuit with no input: the oscillator is drawn first and its output connector to its right. |
| [`relaxation-oscillator.schem.json`](relaxation-oscillator.schem.json) | Relaxation oscillator | An op-amp with feedback to both inputs: timing parts above, the threshold divider below. |

All eight print `valid` and exit with code 0.

The last three are drawn the way they are because schem recognises them: [`docs/templates.md`](../docs/templates.md) lists every circuit it knows.
