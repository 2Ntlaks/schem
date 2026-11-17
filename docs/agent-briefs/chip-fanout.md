# Fan-out from a chip

The maintainer asked for a layout fix for the fan-out job in
`docs/general-layout.md`. In the `shift` and `mcu` benchmark circuits,
neighboring output pins drive tall branches that share one column.
Route these branches along their driver rows or stagger them based on
netlist topology. Keep deterministic drawings and edit stability.

## Scope

- Branch `codex/chip-fanout`.
- Layout changes may touch `src/layout/flow.ts`, `src/layout/layout.ts`,
  and `src/layout/stacks.ts`. Use the smallest change that solves the job.
- A focused test may be added outside `tests/fixtures/`. Record any
  rule changes in `docs/general-layout.md`.
- Keep the benchmark baseline. Follow `AGENTS.md` for protected paths,
  required checks, and image review.
