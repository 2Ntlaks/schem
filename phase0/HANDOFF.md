# Handoff: Phase 0b cases and judge kit (agent B)

For agent A and the owner. 2026-10-23, against SPEC rev C.2.

## Commits

| Commit | What |
|---|---|
| `8370f6b` | **The freeze.** 12 cases, 16 edit scripts, `cases/test/NOTES.md`, `MANIFEST.sha256` (29 files), the module definitions, `proposed-symbols.json`, `check-cases.ts`, `write-manifest.ts`, README, AUTHOR-NOTES |
| `1f0813e` | The layer 6 blind-judge kit, `phase0/judge/` |
| (this file's commit) | `HANDOFF.md` |

All three commits touch `phase0/` only. Nothing was pushed, and no `*.test.ts` file was added.

## Check the freeze

```
npx tsx phase0/check-cases.ts      # loads all 12 cases and 16 edits through src/core; verifies MANIFEST.sha256; exit 0 = ALL OK
npx tsx phase0/judge/selftest.ts   # judge kit end to end on throwaway images; 17 checks
```

At `1f0813e` both print **ALL OK**. `check-cases.ts` prints test-set details only with `--show-test`, so agent A can run it before the end gate without seeing the test cases. The case 11 edit scripts are listed by name only.

## What is frozen

- **Validation** (`cases/validation/`): 1 LED, 2 divider + buffer, 3 summing amp, 4 H-bridge, 5 ESP32 + I2C, 6 ESP32 relay driver, 7 two ICs with decoupling (`decouples` hints), 8 differential pair. Cases 1, 3 and 5 are byte-for-byte copies of `cases/`.
- **Test** (`cases/test/`): 9 555 astable, 10 bridge + 7805, and the SPEC 15 substitutes for the owner's projects: 11 Arduino Uno + LCD + DHT22 + buzzer + button, and 12 ESP32 + MOSFET LED-strip driver + buck module + status LED. The owner supplied no projects before the freeze. **Agent A: do not open `cases/test/` or `cases/edits/case11-*.json` before the end gate.**
- **Edit scripts** (`cases/edits/`): cases 3, 5, 7 and 11, four each: longer value, add part, remove part, pin sides. Each carries `expect.affectedParts` from the SPEC 9.5 table.
- After the freeze, no file under `cases/` changes. A correction is a **new** file plus a note in AUTHOR-NOTES, and the manifest gets new lines (`write-manifest.ts` refuses to overwrite).

**How the cases were checked.** Every module and chip pin was checked against the manufacturer's document: Espressif ESP32-DevKitC V4 guide; Arduino A000066 datasheet and full pinout; Waveshare LCD1602 I2C wiki; Pololu D24V10F5; TI NE555 SLFS022K and LM7805 SNOSBT0L; Microchip ATmega328P DS40002061B and 24LC256 DS20001203; Aosong DHT22. URLs and revisions are in each module's `doc` field and in `ext.phase0.pinSources`.

An **independent reviewer agent** then re-downloaded every document and audited pins, circuits, data model and edit scripts. It found no blockers and no pin mismatches. Its four should-fix findings were fixed **before** the freeze:
- potentiometer numbering is now wiper = 2;
- case 3's pin-sides script now expects `"either"`;
- case 8 values (1 mV input, 10k load) keep the output in range;
- case 11's redundant I2C pull-ups were removed (the module has its own), and case 12's MOSFET was changed to one specified at a 2.5 V gate drive.

## What Phase 0b must add for the cases to load in the engine

`check-cases.ts` resolves pins today through the proposals. The engine itself needs:

1. **Symbols** (SPEC 7.2), with the pin numbers and names in `proposed-symbols.json` (or a correction of that file plus the cases):

   | Type | Used by |
   |---|---|
   | `diode` | 6, 10, 11 |
   | `npn` | 6, 8, 11 |
   | `pnp` | 8 |
   | `nmos` | 4, 12 |
   | `pmos` | 4 |
   | `polarised-capacitor` | 9, 10, 11, 12 |
   | `potentiometer`, `spst`, `pushbutton`, `buzzer` | 11 |
   | `motor` | 4 |
   | `relay` | 6 |
   | `fuse` | 12 |
   | `ac-source` | 10 |
   | `header` (inline pins, like `ic`) | 4, 6, 7, 11, 12 |

2. **Modules** (SPEC 7.3), read from `assets.definitions` or shipped in the library, identical to `phase0/modules/*.json`: `module:esp32-devkitc-v4` (cases 6, 12), `module:arduino-uno-r3` (11), `module:waveshare-lcd1602-i2c` (11), `module:pololu-d24v10f5` (12).
3. **The SPEC 6.5 file shape** (`schema`, `meta`, `intent`, `assets`, `ext`, canonical endpoints) alongside the Phase 0a shape of cases 1, 3 and 5.
4. **`decouples` hints** in the JSON shape `{ id, type: "decouples", part, pin, priority }` (case 7).
5. **Edit operations**: `setProp`, `addPart` + `connect`, `removePart`, `removeHint` and `setPinSides`, read from the edit-script `ops` array.

## Open questions

For agent A to fold into the spec, or for the owner to rule on. Details are in `AUTHOR-NOTES.md`; the item numbers below refer to it.

1. **Case 3 pin sides** (item 21): the only "IC" in case 3 is the fixed op-amp symbol. Should `setPinSides` on it be a vertical mirror, or a rejection? The script accepts either.
2. **Affected parts** (item 23): by the SPEC 9.5 table, an edit touching GND affects nearly every part, which leaves gate 4 very few "untouched" parts. Proposal: leave port-drawn power and ground nets out of the rule.
3. **Group representative** (item 9): natural order puts the Uno's GND representative on the USB chip's ICSP header. Proposal: let a module order its group members or name a preferred representative.
4. **Smaller spec gaps:**
   - the module definition shape (item 4);
   - board pins whose power direction depends on how the board is powered (item 6);
   - `pins` on header parts (item 13);
   - `props.controller` on an `ic` (item 16);
   - two capacitors in one pin's decoupling slot (item 17);
   - the edit-file shape (item 18);
   - `setPinSides` order and unnamed pins (item 20);
   - `removePart` with hints that name the part (item 22);
   - negative supply names (item 25);
   - one-endpoint power nets drawn as a port (item 26).
5. **Case 11 has 24 parts, not "about 30"** (test notes). Gate 6's 30-part timing target may need a generated 30-part circuit as well.
6. **Case 5 (copied)** keeps its invented pin numbers 1-4 and a `power_in` 3V3 (item 10). Should a corrected copy be added as a new file?

## Not done: baselines (stretch)

`phase0/baselines/` was not started, because the brief says to ask the owner before installing anything. Running the three baselines would need:
- **Python 3** with `skidl` (and the KiCad symbol libraries it reads part pins from), and `schemdraw` with `matplotlib`, in a virtual environment outside the repo;
- **netlistsvg** from npm, installed in its own folder, not in `package.json`, with its analog skin. SKiDL's `generate_svg()` also uses it;
- the repo's existing `@resvg/resvg-js` for SVG-to-PNG, so every tool's image is rasterised the same way.

Versions would be pinned at install time and recorded in `phase0/baselines/VERSIONS.md`.

## Independence

Agent B did not read `src/layout/`, `src/verify/`, `src/render/`, `src/quality/`, `scripts/` or `out/`. It read `SPEC.md`, the brief, `cases/`, `tests/fixtures/README.md`, `src/core/`, `src/symbols/library.ts` and (for `cmpNatural`) `src/geom/geom.ts`.
