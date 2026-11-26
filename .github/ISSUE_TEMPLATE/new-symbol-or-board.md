---
name: New symbol or board
about: Request or propose a built-in symbol or a dev board / breakout module
title: "[part] "
labels: parts
assignees: ""
---

Use this form to request a new schematic symbol (`src/symbols/library.ts`) or a dev board / breakout module (`src/modules/*.json`).

## Kind of part

- [ ] Built-in symbol (drawn with SVG path data in `src/symbols/library.ts`)
- [ ] Board or breakout module (JSON pinout file in `src/modules/<name>.json`)

## Name and proposed type ID

- Product or symbol name:
- Proposed type ID (for example `triac` or `module:sparkfun-qwiic-bme280`):

## Official documentation

For a board module, every pin number and name must come from the manufacturer's official documentation (pinout page, user guide or datasheet), not from memory or third-party pinout pictures.

- Official datasheet / pinout URL:
- Document revision or date:

## Pins and usage

List the pins, roles, and any pin groups (such as shared `GND` pins) or standard buses (`i2c`, `spi`), or describe the standard IEEE/IEC symbol shape needed:

-

## Example circuit

Describe (or paste) a small real circuit where you want to use this part:

```text
# Optional example circuit
```

## Contributor checklist (if you plan to open a PR)

- [ ] Checked `docs/parts.md` to confirm the symbol or module does not already exist
- [ ] For a symbol: hand-drawn IEEE/IEC SVG paths (not copied from a GPL or incompatible library) and added a circuit in `tests/support/symbol-circuits.ts`
- [ ] For a board: every pin verified against the official manufacturer document listed in `doc.url` and `doc.revision`
- [ ] Will run `npm run docs:parts` and inspect the rendered PNG before opening the PR
