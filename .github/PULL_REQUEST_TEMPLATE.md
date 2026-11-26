## Summary

Describe what this pull request changes and why. Keep each pull request to one topic.

Closes #

## Files changed

-

## Verification checklist

Run and check every item that applies (see `CONTRIBUTING.md`):

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run phase0` passes (all 8 validation circuits stay `valid`)
- [ ] Visually inspected every PNG produced or changed
- [ ] If touching `src/layout/`: `npm run bench -- --check` passes and before/after PNGs are attached below
- [ ] If touching CLI, MCP, or packaging: `npm run build` and `npm run pack:smoke` pass
- [ ] If adding a symbol or board: ran `npm run docs:parts`, committed `docs/parts.md`, and linked official docs (for boards)
- [ ] Did not edit `phase0/`, `tests/fixtures/`, or held-out test files, and did not weaken tests

## Before and after images (for drawing or layout changes)

Attach before and after PNGs here if this change affects rendered schematics.

## Notes or open questions

Note any trade-offs, skipped checks (and why), or questions for reviewers.
