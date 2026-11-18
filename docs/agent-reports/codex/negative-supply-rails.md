**Negative supply rails are implemented on `codex/negative-supply-rails`. One test expectation needs maintainer review.**

The push-pull amplifier now shows Q1 above the shared output and Q2 below it. Both `VEE` connections have labelled, downward-facing supply symbols. I inspected the drawing. Its benchmark score improved from **134.2 to 73.9**, with zero wire crossings. [Before][before] · [After][after]

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run bench -- --check` | All 18 circuits valid. The other 17 scores matched their baselines. |
| `npm test` | 544 passed, 1 failed. Both new regression tests passed. |
| `npm run phase0` | Skipped after the test failure, as required by the repository rules. |

The failure is `case08-diffpair` in `tests/findings-snapshot.test.ts`. Its source V3 has its negative terminal on `-12V`. The saved expectation warns that the supply side should point up. With negative supplies drawn downward, the checker reports `status: "valid"` and `findings: []`. I preserved the saved expectation for review.

**May I update the saved expectation for this case and rerun the full checks?**

The implementation changes are in `src/core/model.ts`, `src/layout/kinds.ts`, `src/layout/layout.ts`, `src/layout/stacks.ts` and `src/quality/conventions.ts`. I added coverage in `tests/general-layout.test.ts`, updated the README and the netlist and layout guides, and saved the two comparison images with this report.

[before]: ../img/negative-supply-before.png
[after]: ../img/negative-supply-after.png
