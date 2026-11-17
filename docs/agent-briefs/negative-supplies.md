# Negative supplies

The user approved the negative supplies layout job documented in
`docs/general-layout.md`. Work on `codex/negative-supplies`.

Follow `SPEC.md` sections 6.3 and 9.1. Recognize negative supply names,
draw downward supply symbols, and place negative rails and their stacks
below the signal path. The `pushpull` benchmark demonstrates the issue.

Source edits are limited to `src/core/model.ts`, `src/layout/layout.ts`,
`src/layout/stacks.ts`, `src/layout/ports.ts`, `src/layout/flow.ts`,
`src/render/svg.ts`, and `src/quality/conventions.ts`.
`src/layout/kinds.ts` is also in scope to share the transistor
orientation rule with stacks and orient potentiometers towards the
correct rail. Focused tests outside fixtures and relevant layout
documentation can also change.

Run the repository checks and inspect the drawings. Leave the frozen
cases, specification, fixtures, and benchmark baseline untouched.
