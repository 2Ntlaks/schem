# Development cases (Phase 0a)

This folder holds the three original Phase 0a development circuits:

- [`case01-led.json`](case01-led.json): LED indicator with battery and resistor.
- [`case03-summing.json`](case03-summing.json): three-input inverting summing amplifier.
- [`case05-i2c.json`](case05-i2c.json): ESP32 with two I2C sensors and pull-up resistors (using inline `ic` pins from Phase 0a).

## Why these files stay here

These files use the earlier `meta` plus `circuit` JSON shape and are kept as stable fixtures for:

- `npm run draw` ([`../scripts/draw.ts`](../scripts/draw.ts)), which renders every JSON file in this folder to `out/`.
- Continuous integration (CI) cross-platform determinism checks in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), which hash the rendered SVG and PNG outputs on Windows and Linux to confirm they are byte-identical.
- Automated tests such as [`../tests/alt-text.test.ts`](../tests/alt-text.test.ts).

## Looking for starter circuits?

For up-to-date starter circuits in the `.schem` text format and the `schem/1.0` JSON format, see [`../examples/`](../examples/) and [`../examples/README.md`](../examples/README.md).
