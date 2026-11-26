# Report: Verified board modules and text schematic examples

- Branch: `t3/2caf47c5`
- Worktree: `C:/Users/ntlak/.t3/worktrees/Schematic circuit/t3-2caf47c5-d125293bc2b2084d`
- Base commit: `1e235fc`
- Commits (prior to this report):
  - `cffaac2` Add six verified board modules from official docs
  - `7692e36` Add three text schematic examples for new board modules
  - `39df225` Add tests for six new board modules and text examples

## Summary of work

Six board modules were added under `src/modules/`, each verified directly against official manufacturer documentation (PDFs, schematics, and official documentation pages retrieved on `2026-11-26`). None of the four existing Phase 0 corpus modules were modified.

Three real-world text schematic (`.schem`) examples were added under `examples/`, documented in `examples/README.md`, drawn with `npm run schem -- draw`, and visually inspected as PNGs.

A new test suite `tests/modules-extra.test.ts` was added to verify module loading, pin metadata, group resolution, realistic circuit layout, layers 1-2 verification (`checkDrawing`), canonical JSON round-tripping, and deterministic SVG output across all six new modules and all three new `.schem` examples.

## Official documentation used for pin verification

Every pin number, name, alias, role, group, and bus interface was checked directly against the primary manufacturer files below (retrieved `2026-11-26`):

| Module | Pins | Official URL(s) | Revision / Date | Notes for reviewer |
|---|---|---|---|---|
| `module:raspberry-pi-pico` (`src/modules/raspberry-pi-pico.json`) | 40 | `https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf` (resolves to `RP-008307-DS-3-pico-datasheet.pdf`) and `https://datasheets.raspberrypi.com/pico/Pico-R3-A4-Pinout.pdf` (resolves to `RP-008309-DS-1-Pico-R3-A4-Pinout.pdf`) | Raspberry Pi Pico (RP2040, Rev 3); Datasheet `RP-008307-DS-3` (2026-11-19); Pinout `RP-008309-DS-1` | `controller: true`. Pins 1-40 follow DIP-40 edge order. Group `GND` covers pins 3, 8, 13, 18, 23, 28, 33 (`AGND`), 38. Pin 36 (`3V3(OUT)` on the diagram) is named `3V3_OUT` with alias `3V3` so dotted references work. Default I2C0 (`GP4`/`GP5`) and SPI0 (`GP16`-`GP19`) carry `iface` tags. |
| `module:arduino-nano` (`src/modules/arduino-nano.json`) | 30 | `https://docs.arduino.cc/resources/pinouts/A000005-full-pinout.pdf`, `https://docs.arduino.cc/resources/schematics/A000005-schematics.pdf`, `https://docs.arduino.cc/resources/datasheets/A000005-datasheet.pdf` | Nano V3.3 (SKU `A000005`); full pinout `30/06/2021`; schematic `NanoV3.3 23/01/19`; datasheet Rev 5 `Modified: 19/11/2026` | `controller: true`. DIP-30 numbering matches schematic `J1` (1-15: `D1` to `D12`) and `J2` (16-30: `D13` down to `VIN`, matching datasheet page 2: pin 27 `+5V`, pin 30 `VIN`). Groups: `GND` (4, 29), `RESET` (3, 28). `A6`/`A7` are `input` (analog-only on ATmega328P). I2C on `A4`/`A5`, SPI on `D10`-`D13`. |
| `module:esp32-s3-devkitc-1` (`src/modules/esp32-s3-devkitc-1.json`) | 44 | `https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html` | ESP32-S3-DevKitC-1 v1.1 (`latest` as retrieved) | `controller: true`. Pins `J1-1`..`J1-22` and `J3-1`..`J3-22` match the Header Block tables directly. Group `GND`: `J1-22`, `J3-1`, `J3-21`, `J3-22`. Group `3V3`: `J1-1`, `J1-2`. GPIO pins use `GPIO<n>` with `IO<n>` and `<n>` aliases (`J3-2` is `TX`/`GPIO43`, `J3-3` is `RX`/`GPIO44`). No fixed bus `iface` roles due to GPIO matrix. |
| `module:adafruit-bme280` (`src/modules/adafruit-bme280.json`) | 7 | `https://learn.adafruit.com/adafruit-bme280-humidity-barometric-pressure-temperature-sensor-breakout/pinouts` and rev C schematic from `https://learn.adafruit.com/adafruit-bme280-humidity-barometric-pressure-temperature-sensor-breakout/downloads` | Adafruit BME280 STEMMA QT rev C (schematic `2020-07-20`; Pinouts guide edited `2024-03-08`) | `controller: false`. Header `JP1` pins 1-7: `VIN`, `3Vo`, `GND`, `SCK` (`spi.sck`, `i2c.scl`), `SDO` (`spi.miso`), `SDI` (`spi.mosi`, `i2c.sda`), `CS` (`spi.ss`). |
| `module:ssd1306-oled-i2c` (`src/modules/ssd1306-oled-i2c.json`) | 4 | `https://github.com/sparkfun/SparkFun_Qwiic_OLED_1.3in/blob/main/docs/assets/board_files/SparkFun_Qwiic_OLED_1.3in_Schematic.pdf` and `https://docs.sparkfun.com/SparkFun_Qwiic_OLED_1.3in/hardware_overview/` | SparkFun `Qwiic_OLED_1.3in` rev `v10` (schematic date `2023-06-09`; SSD1306 controller) | `controller: false`. Breakout header `J3` (and Qwiic `J1`/`J2`) pins 1-4: `GND`, `VCC` (aliases `3V3`, `VDD`), `SDA` (`i2c.sda`), `SCL` (`i2c.scl`). Waveshare wiki returned a Cloudflare 403 challenge, so SparkFun's directly verified schematic PDF was used. |
| `module:lm7805` (`src/modules/lm7805.json`) | 3 | `https://www.ti.com/lit/ds/symlink/lm340.pdf` and `https://www.ti.com/lit/ds/symlink/ua78.pdf` | TI `SNOSBT0L` (Feb 2000, Revised Sept 2016) and TI `SLVS056P` (May 1976, Revised Jan 2015) | `controller: false`. 3-pin TO-220 (`NDE`/`KCS`) Pin Functions table: `1` `IN` (`power_in`, aliases `INPUT`, `VIN`), `2` `GND` (`ground`, alias `COMMON`), `3` `OUT` (`power_out`, aliases `OUTPUT`, `VOUT`). |

## Files changed

- Added `src/modules/raspberry-pi-pico.json`
- Added `src/modules/arduino-nano.json`
- Added `src/modules/esp32-s3-devkitc-1.json`
- Added `src/modules/adafruit-bme280.json`
- Added `src/modules/ssd1306-oled-i2c.json`
- Added `src/modules/lm7805.json`
- Added `examples/pico-i2c-oled.schem`
- Added `examples/lm7805-supply.schem`
- Added `examples/nano-bme280.schem`
- Updated `examples/README.md`
- Added `tests/modules-extra.test.ts`
- Added `docs/agent-reports/neon-board-modules.md`

## Visual inspection of generated example PNGs

All three new examples were drawn with `npm run schem -- draw <file>` and opened as PNGs:

- `out/pico-i2c-oled.png`: `valid` (jogs 0, squeezedRuns 0, farLabels 0, crossings 1 on the I2C pull-up drop). `U1` (Raspberry Pi Pico) on the left, `R1`/`R2` 4.7 kOhm pull-ups above the parallel SDA/SCL lines, `OLED1` (SSD1306 I2C OLED Display) on the lower right, and status LED `D1` with `R3` on `GP15`. Labels are clear with no overlaps.
- `out/lm7805-supply.png`: `valid` (crossings 0, bends 2, jogs 0, squeezedRuns 0, farLabels 0). Left-to-right flow: `B1` (12 V) through horizontal `D1` (1N4007), `C1` (330 nF) shunt to GND, `U1` (LM7805 5V Linear Regulator with `IN` left, `GND` bottom, `OUT` right), `C2` (100 nF) on `5V`, and `R1`/`D2` power indicator LED. Clean textbook layout.
- `out/nano-bme280.png`: `valid` (jogs 0, squeezedRuns 0, farLabels 0, crossings 1 on the I2C pull-up drop). `A1` (Arduino Nano) on the left, `R1`/`R2` 4.7 kOhm pull-ups to `5V`, `U1` (Adafruit BME280 Breakout) on the lower right, and blue LED `D1` with `R3` on `D9`. Labels are crisp and unobstructed.

## Verification commands and outputs

### Example draws

```text
> npm run schem -- draw examples/pico-i2c-oled.schem
pico-i2c-oled: valid. Wrote out/pico-i2c-oled.svg and out/pico-i2c-oled.png (216 ms)

> npm run schem -- draw examples/lm7805-supply.schem
lm7805-supply: valid. Wrote out/lm7805-supply.svg and out/lm7805-supply.png (216 ms)

> npm run schem -- draw examples/nano-bme280.schem
nano-bme280: valid. Wrote out/nano-bme280.svg and out/nano-bme280.png (209 ms)
```

### `npm run typecheck`

```text
> schem-cli@0.0.1 typecheck
> tsc --noEmit && tsc --noEmit -p web
(exit code 0)
```

### `npm test`

```text
> schem-cli@0.0.1 test
> vitest run

 Test Files  33 passed (33)
      Tests  683 passed (683)
   Duration  18.83s
(exit code 0)
```

### `npm run phase0`

```text
> schem-cli@0.0.1 phase0
> tsx scripts/phase0.ts

case                           status                             verifier  overlaps conv read ms
case01-led                     valid                              valid     0        0    0    171
case02-divider-buffer          valid                              valid     0        0    0    56
case03-summing                 valid                              valid     0        0    0    20
case04-hbridge                 valid                              valid     0        0    0    205
case05-i2c                     valid                              valid     0        0    0    13
case06-esp32-relay             valid                              valid     0        0    0    27
case07-two-ic-decoupling       valid                              valid     0        0    0    30
case08-diffpair                valid                              valid     0        0    0    11
(all 12 edit scripts passed; exit code 0)
```

## Skipped items and open questions

- `docs/parts.md` was intentionally not modified per file ownership rules; run `npm run docs:parts` during integration to include the six new boards.
- `npm run bench -- --check` was skipped because `src/layout/` was not touched.
- Open question: on `module:ssd1306-oled-i2c`, SparkFun's Qwiic OLED 1.3in rev v10 schematic (`GND, VCC, SDA, SCL` on pins 1-4, 3.3 V only) was used because Waveshare's wiki returned a Cloudflare 403 challenge. If a 3.3 V/5 V Waveshare board pin order (`1: VCC, 2: GND, 3: SCL, 4: SDA`) is specifically preferred later, a maintainer can cross-check against a locally fetched Waveshare PDF.
