# Frozen edit-stability regressions

These 14 fixtures preserve every gate-4 failure from the original 150-seed probe against the edit engine in commit `42478dc`.

The probe used `generate(seed, 5)` and `randomEdit(circuit, seed * 31)`. Each file contains the circuit, the exact pre-edit layout, the edit operations, the original failure messages, and the affected-part/net scope computed by the original engine. The regression runner reads these snapshots directly, so changes to the generator, canonical placement, or affected-scope classification cannot silently remove a failure.

Seeds: `31, 38, 60, 64, 76, 80, 83, 92, 97, 101, 107, 114, 133, 143`.

Run `npx vitest run tests/edit-stability.test.ts tests/edits.test.ts` or the complete `npm test`. Existing CI runs `npm test` on Windows and Linux.

Every frozen edit must save, independently pass connectivity and overlap checks, and satisfy all gate-4 limits using the frozen affected scope. Repeating the same request must produce identical SVG and layout tokens. A following no-op edit must preserve the resulting layout, and the inputs and built-in symbol definitions must remain unchanged.

The generated sweep separately requires all eligible edits among seeds 1 through 150 to save and pass gate 4. Rejections cannot improve its score. These are development regressions; the Phase 0b evaluation corpus remains in `phase0/`.

With the stability fixes, all 14 edits keep untouched parts at their original positions and orientations. Seeds 31 and 92 each reroute one unrelated net; the other 12 reroute none. All complete incrementally.

Update these snapshots only after reviewing the changed circuit, starting layout, operation, or affected scope. Preserve the original failure evidence.
