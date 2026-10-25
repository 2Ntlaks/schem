# Session handoff (agent A, lead session)

For the next Claude Code session (any account) that continues Phase 0b. Read this first, then `SPEC.md` (rev C.3), `docs/PHASE0B-NOTES.md`, `phase0/HANDOFF.md`.

Last updated: 2026-10-26, by the lead session on account 4.

## Standing rules

- **Test-set hygiene:** the layout builder (you) must not open `phase0/cases/test/` or `phase0/cases/edits/case11-*` until the Phase 0b end gate. Never run `npm run gates -- --test` or `npm run phase0 -- --test` before then.
- Never edit `phase0/` (frozen by agent B, SHA-256 manifest) or `tests/fixtures/` (written independently from the spec).
- Self-verify before showing the owner anything: tests, typecheck, `npm run phase0`, look at the PNGs, then blind AI judges.
- No em or en dashes in docs. Commit messages end with the Co-Authored-By line. Do not push without the owner's say-so.
- The owner also commits to `main` directly (for example `522217b`, decoupling child slots). Check `git status` before merging; if the main checkout has someone else's uncommitted changes, ask.

## State of `main`

Merged: spec rev C.3 (owner confirmed all six rulings), 15 Phase 0b symbols, SPEC 6.5 loader + modules + `decouples` hints + edit-script runner (`src/io`, `src/modules`), `npm run phase0`, the owner's decoupling child slots, the gate runner `npm run gates` (`scripts/gates.ts`, `scripts/lib/case-run.ts`, `scripts/lib/gate-math.ts`, owner's `scripts/lib/phase0-gates.ts`).

Validation set on main: all 8 cases pass the verifier; case 4 (H-bridge) is still `valid_low_confidence` (gate 1 fails on it); 12 of 12 validation edit scripts pass gate 4; gate 6 fails (findings fix dry-runs take 3-10 s).

## Work on branches, not yet on `main`

Worktrees live in `.claude/worktrees/<name>`; branches are `worktree-agent-<id>`.

| Branch | What | Status / next step |
|---|---|---|
| `worktree-agent-a64ae799f724ab560` | Pattern templates (SPEC 9.4): engine in `src/layout/templates/`, op-amp inverting/summing, non-inverting, I2C pull-ups, divider, pull-up/down, LED. Round 2: H-bridge (case 4), low-side switch (case 6), bridge rectifier, module name labels. | Must merge `main` into itself: 8 conflict hunks in `src/layout/layout.ts` against the owner's decoupling slots. Keep both behaviours; never edit the owner's tests to pass. Then merge into main. |
| `worktree-agent-a18f81d0292fbac91` | Gate 6 performance: make findings fix dry-runs fast, byte-identical findings output (snapshot test). Based on main + gate runner + templates round 1. | Merge after the templates branch. |
| (no branch) baselines | SKiDL, netlistsvg, schemdraw installed in `C:\Users\ntlak\schem-baselines\`; outputs in `baselines/` in the main checkout (untracked). | Commit `baselines/` when done (test-case images under `baselines/out/<tool>/test/`: do not open them before the end gate). |

If a branch's last commit is marked WIP, its agent was stopped by a usage limit: read its last commit message and `docs/PHASE0B-NOTES.md`, then finish the step.

## Next steps after the branches land

1. `npm run gates` on the validation set: gate 1 8/8, gate 4 12/12, gate 6 < 3 s.
2. Blind AI judge panel on the validation pack (`phase0/judge/README.md`), fix what judges flag, repeat.
3. Owner's blind rating of the validation set (gate 3: 7 of 8 at 4+), with baselines (gate 5).
4. Only then the end gate: run `--test` once, owner rates all 12 (gates 2 and 5).
