**The two-transistor LED oscillator now draws as a mirrored pair.** Each LED and resistor sits above its transistor. Both timing capacitors sit between the transistors, so you can trace each collector to the opposite base without leaving the pair. [Previous drawing][before]

![Mirrored oscillator with both feedback paths between Q1 and Q2][after]

Wire length fell from **163 to 74 grid steps**, bends from **7 to 2**, and the benchmark score from **68.7 to 63.3**. The compact layout introduces two undotted crossings. The dots mark the actual junctions, and the verifier recovered every connection from the drawing.

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test` | All 551 tests passed |
| `npm run phase0` | All 8 validation drawings passed with zero overlaps |
| `npm run bench -- --check` | All 18 circuits were valid. No score regressed. |

Tests cover renamed parts, reordered input, a missing capacitor, and capacitors wired back to their own transistors. The first test run exposed an incorrect template lookup in the new test. I corrected it with approval and reran the suite.

Committed on `codex/transistor-astable`. Changes cover the template library, two test files, the README, the layout and template guides, and the comparison images. I reviewed the generated drawings. The held-out evaluation was skipped under the repository rules.

[before]: ../img/transistor-astable-before.png
[after]: ../img/transistor-astable-after.png
