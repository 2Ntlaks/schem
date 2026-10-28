# Rules for coding agents in this repo

This file is for any coding agent working here (Claude Code, Codex, opencode and others), whether for the maintainers or for an outside contributor. Read it fully before you start. Maintainers review and merge your work; a person signs off on every pull request.

## What this project is

`schem` is an engine that turns a circuit description (a netlist in JSON) into a clean schematic drawing (SVG and PNG), so AI agents can draw circuits for blog posts, reports and theses. TypeScript, Node 22+, `npm`. The design lives in `SPEC.md`; build notes in `docs/PHASE0B-NOTES.md`.

## Where you may and may not write

Your task is either a brief in `docs/agent-briefs/` or the issue you were asked to work on. Write only where the task needs. In any case:

- **Never edit** files under `src/` that your task does not name. Adding a symbol to `src/symbols/library.ts` is fine when that is the task; changes to the layout engine (`src/layout/`) need an issue the maintainers agreed to first.
- **Never edit** `phase0/` (frozen test cases, checked by a SHA-256 manifest), `tests/fixtures/` (written independently from the spec), or `SPEC.md`.
- **Never open, list, read or run** anything under `phase0/cases/test/`, `phase0/cases/edits/case11-*`, `baselines/LOG-test.md`, `baselines/out/*/test/` or `baselines/out/_netlist/test/`. These are the held-out test set; looking at them spoils the final evaluation. Never run `npm run gates -- --test` or `npm run phase0 -- --test`.
- **Never change a test to make it pass.** If a test fails, stop and report it.
- Do not install packages into the repo (`package.json` dependencies) unless your brief allows it.

## How to work

1. Work on your own git branch, never on `main`: `git switch -c <branch named in your brief, or a short descriptive name>`. Commit in small steps with clear messages. Never push, never merge, never rebase `main`.
2. Before you report, run and pass all of these:
   - `npm run typecheck`
   - `npm test`
   - `npm run phase0` (all 8 validation cases must stay `valid`)
3. Look at every image you produce or change (open the PNG). A drawing that the code calls valid can still look wrong.
4. If something is unclear, or a step would need a rule above to be broken, stop and write the question in your report. Do not guess.

## Writing style for docs and reports

- No em dashes or en dashes anywhere; use hyphens, colons or full stops.
- Plain English, short sentences. Explain each tool or term the first time it appears.
- Report facts: what you ran, what passed, what failed (with the output), what you skipped and why. Never claim a check passed that you did not run.

## Report at the end of every task

For a maintainer brief, finish with a report in `docs/agent-reports/<branch-name>.md` (and the same text as your last message). For an outside contribution, put the report in the pull request description instead. Either way, cover:
what you did, the files you changed, the commands you ran with their results, anything you skipped or could not do, and open questions.
