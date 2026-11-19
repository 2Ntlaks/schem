**Each shift-register output, QA through QD, now runs straight from its pin and turns once into its resistor and LED.** Total bends fell from 14 to 8, with zero crossings. The drawing is wider and shorter. The chip-select wire takes a detour above capacitor C1. [Before][shift-before] · [After][shift-after]

The microcontroller's two LED outputs also take one turn each. Total bends fell from 12 to 10, with zero crossings. [Before][mcu-before] · [After][mcu-after]

I brought the existing fan-out implementation from `codex/chip-fanout` onto `codex/chip-fanout-rails`, which includes the negative supply rails. The change covers branch detection in `flow.ts`, placement in `layout.ts`, regression tests in `chip-fanout.test.ts`, and the general layout guide.

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test` | All 548 tests passed |
| `npm run phase0` | All 8 validation drawings passed with zero overlaps |
| `npm run bench -- --check` | All 18 circuits were valid. No score regressed. |

I inspected the benchmark, validation, and edit drawings. The held-out evaluation was skipped under the repository rules.

[shift-before]: ../img/fanout-shift-before.png
[shift-after]: ../img/fanout-shift-after.png
[mcu-before]: ../img/fanout-mcu-before.png
[mcu-after]: ../img/fanout-mcu-after.png
