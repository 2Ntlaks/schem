**Negative supply rails are complete on `codex/negative-supply-rails`. All four required checks passed.**

The push-pull amplifier now shows Q1 above the shared output and Q2 below it, with both `VEE` connections labelled beneath their pins. Its benchmark score improved from **134.2 to 73.9**, with zero wire crossings. [Before][before] · [After][after]

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test` | All 545 tests passed |
| `npm run phase0` | All 8 validation drawings passed with zero overlaps |
| `npm run bench -- --check` | All 18 circuits were valid. The other 17 matched their baseline scores. |

I regenerated `tests/snapshots/findings.json` and verified that only `case08-diffpair` changed. The checker now accepts V3 with its negative terminal below ground and no longer suggests rotating it. I also reviewed the benchmark, validation, and edit drawings.

The changes cover rail classification, placement, drawing checks, regression tests, and the netlist and layout guides. The held-out evaluation was skipped under the repository rules.

[before]: ../img/negative-supply-before.png
[after]: ../img/negative-supply-after.png
