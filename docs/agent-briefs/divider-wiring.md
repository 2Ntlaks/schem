# Route a loaded voltage divider with two T junctions

Resolve the divider loop documented in `docs/general-layout.md` for the common-emitter amplifier, emitter follower, and transistor mixer. Shift the lower resistor by two grid units, or use equivalent topology-based placement, so opposing connections can join at legal T junctions. Keep the four-way junction rule and existing verification intact. Use circuit connectivity to make placement decisions.

Authorized source files are `src/layout/templates/library.ts`, `src/layout/router.ts`, `src/layout/stacks.ts`, and `src/layout/layout.ts`. Add focused regression coverage outside test fixtures and update the general layout notes if needed. Follow the validation and image review steps in `AGENTS.md`. Keep every benchmark at or above its recorded score.
