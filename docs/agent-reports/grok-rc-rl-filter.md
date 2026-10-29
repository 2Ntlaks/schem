# RC / RL filter template

Branch: `grok/rc-rl-filter`, from `main` at `2474558`. Not merged.

## What I did

SPEC 9.4 lists an RC / RL filter (series part flat on a signal path, shunt part down to ground) at priority 9, between the voltage divider and the pull-up. It was the one v1 template still missing. This branch adds it as data in the template library. The layout engine is unchanged.

The shape:

```
signal --[ series ]--+-- onward
                     |
                   [ shunt ]
                     |
                    ground
```

There are two copies of template `rc-rl-filter`, both version 1, priority 9.

- A capacitor or inductor shunt hangs on the output column, 2 G under the series part's output pin. A load on that same net stays outside the region. The search keeps one shunt, the lowest part id, so `C1` is taken before a load resistor `RL`.
- A resistor shunt matches only when the output net has two endpoints: the series part and that resistor. It stands 2 G to the right of the series pin, and the corner is pre-routed. On the same column the shunt's approach cell sits on a series capacitor's keep-out (the keep-out reaches 1 G under the pin) and the route fails. A busier output, such as an op-amp pin with a feedback resistor and a load, stays with the pull-down template.

Both pins of the series part must be signal nets. A resistor from a supply does not match, so a divider, a pull-up, and the I2C reset RC are left alone. Outside wires attach to the series part's two pins, not to the shunt.

The type lists name `inductor` and `polarised-capacitor`. The inductor symbol is not on `main` (it is pull request 2). A polarised capacitor's pins are named `+` and `-`, so it does not bind on pin names `1` and `2`.

## Drawings

`npx tsx scripts/templates.ts` wrote `out/templates/rc-filter.png` and `out/templates/rc-highpass.png`. I opened both.

The low-pass is a source on the left, `R1` flat, `C1` standing under the right end of `R1` with a junction dot, and `RL` continuing to the right and down to its own ground symbol. `RL` is the pull-down template, not part of the filter. Valid, 0 crossings, no convention notes, no readability breaches.

The high-pass is a source on the left, `C1` flat along the top, `R1` standing at the right, and a return wire along the bottom to the source. Ground is a wire here, not a symbol, because that net has two endpoints. Valid, 0 crossings, no convention notes, no readability breaches.

The other template circuits kept the same checks they had before. None of the eight validation cases matched `rc-rl-filter`.

## Files

- `src/layout/templates/library.ts`: the template, inserted after the divider.
- `tests/support/template-circuits.ts`: `RC_FILTER` and `RC_HIGHPASS`, included in `TEMPLATE_CIRCUITS` so the determinism check covers them.
- `tests/templates.test.ts`: geometry for both circuits, and a check that the I2C reset RC is not claimed.
- This report.

No new packages. `README.md`, `SPEC.md`, `phase0/`, and `tests/fixtures/` are untouched. The symbol count is unchanged.

## Commands

- `npm run typecheck`: passed (engine and `web/`).
- `npm test`: failed. 490 passed, 4 failed. Details below. I did not edit those tests.
- `npm run phase0`: all 8 validation cases `valid`. case08-diffpair still has 1 convention note, which was already there. Gate lines stay incomplete because this command does not run the held-out set. I did not run `npm run phase0 -- --test` or `npm run gates -- --test`.
- `npx tsx scripts/templates.ts`: both new drawings valid, as above.
- `npx vitest run tests/templates.test.ts tests/findings.test.ts`: 36 passed, including the capacitor-input summing circuit, which must stay `pull-down@1:RL` only.

## What failed, and why I left it

The generator in `tests/support/generate.ts` already builds RC low-passes (series resistor, capacitor to ground). The new template matches those pairs, so two pinned results moved.

1. `tests/findings-snapshot.test.ts`, entry `generated-30-16` (`generate(30, 16)`). The layout now records four filters: `rc-rl-filter@1:C1,R1`, `C2,R2`, `C3,R3`, and `C4,R6`. Findings that changed:
   - `C13-C5`: decoupling distance 81 G became 23 G. Still no fix.
   - `C13-C6`: 91 G became 33 G. Still no fix.
   - `L-jogs`: 1 short step, with a spacing fix, became 6 short steps and no fix.
   - `L-squeezedRuns` is gone.
   Validation cases 1 to 8 in the same snapshot still match. I did not regenerate `tests/snapshots/findings.json`.

2. `tests/edits.test.ts` and `tests/cli-edit.test.ts` (three tests). They use `generate(38, 5)` and expect one edit to move an untouched part 8 G, which is past the 6 G limit, so `--strict` refuses it. That circuit now matches `rc-rl-filter@1:C1,R3`. The same edit reports untouched parts moved 0 G, so it is saved and strict mode does not refuse it.

These failures are the template applying to circuits the generator calls RC low-passes. The denser sheet (`generated-30-16`) gained short steps. I did not retune the tests to hide that.

## Skipped

- Sallen-Key, oscillators, the power-path rule, and dense-board compaction.
- A shunt resistor on an output that also feeds another part (three or more endpoints). That shape is not matched, so a high-pass into a following stage stays with the general placer.
- An inductor drawing. The symbol is not on this branch.

## Open questions

- Should `tests/snapshots/findings.json` be regenerated for `generated-30-16`, given the extra short steps?
- The strict-edit example needs a circuit that still moves an untouched part more than 6 G. I did not search for a new seed.
