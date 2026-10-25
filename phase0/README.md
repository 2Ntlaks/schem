# Phase 0b frozen cases and judge kit

Written by agent B, the independent case author (brief: `docs/agent-briefs/agent-b-cases-and-judge-kit.md`). These are the frozen **inputs** for Phase 0b (SPEC 15): 12 netlists, the hints SPEC 15 allows, and 16 edit scripts. They describe real circuits. Nothing in them reflects what the engine draws well today. Agent B did not read the layout, verify, render or quality code.

**Test-set hygiene:** the layout builder must not open `cases/test/` or the case 11 edit scripts (`cases/edits/case11-*.json`, which name the test case's parts) until the Phase 0b end gate. This README gives only the titles of the test cases, and `AUTHOR-NOTES.md` keeps test-case details out (they are in `cases/test/NOTES.md`).

## Layout

| Path | What it is |
|---|---|
| `cases/validation/` | cases 1-8 (validation set, SPEC 13 item 1) |
| `cases/test/` | cases 9-12 (test set, touched once at the end gate) |
| `cases/edits/` | 16 edit scripts: cases 3, 5, 7 and 11, four edits each |
| `MANIFEST.sha256` | SHA-256 of every file under `cases/`, written once at the freeze |
| `modules/` | the module definitions embedded in the cases (`assets.definitions`), one file each, with the documentation they come from |
| `proposed-symbols.json` | the pin numbers and names assumed for SPEC 7.2 symbol types that `src/symbols/library.ts` does not have yet |
| `check-cases.ts` | loads every case and edit script through `src/core` and reports problems |
| `write-manifest.ts` | writes `MANIFEST.sha256` (run once, at the freeze) |
| `AUTHOR-NOTES.md` | spec ambiguities found while writing the cases, and how each was resolved |
| `judge/` | the layer 6 blind-judge kit (rubric, judge prompt, blind packs, tallying); see `judge/README.md` |
| `HANDOFF.md` | what was built and frozen, the commit hashes, and open questions |

```
npx tsx phase0/check-cases.ts            # every case, edit and the manifest; exit 1 on any failure
npx tsx phase0/check-cases.ts --quiet    # one line per file
```

## Cases

| # | File | Title | Set | Parts | Nets | Pin data from |
|---|---|---|---|---|---|---|
| 1 | `validation/case01-led.json` | LED + resistor + battery | validation | 3 | 3 | built-in symbols (copied from `cases/`, Phase 0a) |
| 2 | `validation/case02-divider-buffer.json` | Voltage divider feeding an op-amp buffer | validation | 6 | 4 | built-in symbols |
| 3 | `validation/case03-summing.json` | Inverting summing amplifier, 3 inputs | validation | 9 | 6 | built-in symbols (copied from `cases/`, Phase 0a) |
| 4 | `validation/case04-hbridge.json` | H-bridge, 4 MOSFETs, motor, gate resistors | validation | 15 | 12 | proposed symbols; IRF9540N / IRF540N part numbers |
| 5 | `validation/case05-i2c.json` | ESP32 + 2 I2C sensors + pull-ups | validation | 5 | 4 | inline `ic` pins (copied from `cases/`, Phase 0a; numbers are not the board's, see AUTHOR-NOTES) |
| 6 | `validation/case06-esp32-relay.json` | ESP32 + relay via NPN driver + flyback diode | validation | 7 | 8 | Espressif ESP32-DevKitC V4 user guide; proposed symbols |
| 7 | `validation/case07-two-ic-decoupling.json` | Two ICs, each with 2 decoupling capacitors (`decouples` hints) | validation | 10 | 5 | Microchip DS40002061B (ATmega328P SPDIP-28), DS20001203Y (24LC256 PDIP-8) |
| 8 | `validation/case08-diffpair.json` | Differential pair with current-mirror load | validation | 9 | 7 | proposed symbols; 2N3904 / 2N3906 |
| 9 | `test/case09-555-astable.json` | 555 astable with LED output | **test** | 9 | 7 | TI SLFS022K (NE555, PDIP-8) |
| 10 | `test/case10-bridge-7805.json` | Bridge rectifier + smoothing capacitor + 7805 regulator | **test** | 11 | 6 | TI SNOSBT0L (LM7805, TO-220) |
| 11 | `test/case11-uno-lcd-dht22.json` | Arduino Uno + I2C 16x2 LCD + DHT22 + buzzer + push button (SPEC 15 substitute) | **test** | 24 | 17 | Arduino A000066 datasheet and full pinout; Waveshare LCD1602 I2C wiki; Aosong DHT22 datasheet |
| 12 | `test/case12-esp32-ledstrip.json` | ESP32 + MOSFET LED-strip driver + buck converter module + status LED (SPEC 15 substitute) | **test** | 11 | 9 | Espressif ESP32-DevKitC V4 user guide; Pololu D24V10F5 product page |

Cases 1, 3 and 5 are byte-for-byte copies of the Phase 0a development cases in `cases/`, in that older shape (`meta` + `circuit` only). Cases 2, 4 and 6 to 12 use the SPEC 6.5 project shape (`schema`, `meta`, `circuit`, `intent`, `assets`, `ext`). Each module's definition is embedded in its case's `assets.definitions`, so the file is self-contained. `check-cases.ts` checks that every embedded copy equals the file in `modules/`.

**Hints.** Only case 7 has hints: one `decouples` hint per decoupling capacitor, as SPEC 15 allows. No other case has a hint, lock or override.

## Edit scripts

Four scripts for each of cases 3, 5, 7 and 11 (SPEC 15). Each script is applied **separately** to the frozen case:

| Edit | File suffix | Operation (SPEC 11.3) |
|---|---|---|
| change one value to a text 3 times longer | `-longer-value.json` | `setProp` |
| add a part on existing nets | `-add-part.json` | `addPart` + `connect` |
| remove a part | `-remove-part.json` | `removePart` (case 7 also `removeHint` for the removed capacitor's hint) |
| change one IC's pin sides | `-pin-sides.json` | `setPinSides` |

Each file holds `case` (the frozen case it applies to, relative to `cases/`), `edit`, `description`, `ops` (the operations, in order, as one transaction), and `expect`: `ok` and `affectedParts`, the parts the SPEC 9.5 table counts as affected. Every other part is "untouched" for gate 4.
