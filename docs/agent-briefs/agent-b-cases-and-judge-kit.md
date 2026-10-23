# Brief for agent B: freeze the Phase 0b cases and build the blind-judge kit

You are working on **schem**, an engine that turns a circuit netlist into a clean schematic drawing for AI agents. The repository is in `C:\Users\ntlak\OneDrive\Documents\Schematic circuit` (branch `main`). Phase 0a is built and the owner has passed its last gate (2026-10-23). Before Phase 0b layout work starts, two things are needed, and they are yours:

1. **Freeze the 12 Phase 0b test cases** (netlists, allowed hints and edit scripts).
2. **Build the layer 6 blind-judge kit** (rubric, blind image packs, tallying).

Another agent (agent A) is working at the same time in the same folder. It is updating `SPEC.md` and building verification layers 2 to 5 in `src/` and `tests/`. You must not touch those files.

## Independence rule (important)

You are the **independent case author**, like the agent who wrote `tests/fixtures/`. The cases must describe real circuits and real drafting expectations, not what the current code happens to draw well.

- **Do not read** `src/layout/`, `src/verify/`, `src/render/`, `scripts/draw.ts` or anything in `out/`.
- You **may read** `SPEC.md`, `docs/`, `cases/`, `tests/fixtures/README.md`, `src/core/` (the data model and validator, to check that your files load) and `src/symbols/library.ts` (to see which symbol types exist today).
- Agent A will not open `phase0/cases/test/` until the end-of-phase gate. Keep the test-set contents out of every other file. For example, `phase0/README.md` may say "case 10: bridge rectifier" but must not describe how it should be laid out.

## Read first

- `SPEC.md`: sections 6 (data model; 6.4 hints, locks and overrides; 6.5 project file), 7.3 (generic ICs and modules), 9.1 (what "looks good" means), 9.4 (pattern templates), 11.3 (edit operations), 13 (testing; development, validation and test sets) and **15 Phase 0b** (the case table, edit scripts, baselines and gates).
- `cases/case01-led.json`, `cases/case03-summing.json` and `cases/case05-i2c.json`: the input format the engine reads today.
- `tests/fixtures/README.md`: how the previous independent author worked.
- `docs/verification-stack.html`: layer 6 (the blind AI judge).

## Task 1: freeze the 12 cases

Layout:

```
phase0/
  README.md                 index: case number, title, set, part count, source of pin data
  AUTHOR-NOTES.md           spec ambiguities you hit, and how you resolved each one
  MANIFEST.sha256           SHA-256 of every file under phase0/cases/, written last
  check-cases.ts            loads every case through src/core and reports problems
  cases/
    validation/case01-led.json ... case08-diffpair.json
    test/case09-555-astable.json ... case12-*.json
    edits/caseNN-<edit>.json   edit scripts (cases 3, 5, 7, 11)
```

- **Cases 1, 3 and 5:** copy them from `cases/` byte for byte. They were the Phase 0a development cases and become validation cases.
- **Cases 2, 4, 6, 7 and 8 (validation) and 9 and 10 (test):** write them from the SPEC 15 table. Use realistic part values and real part numbers where a real part is implied (for example the NE555 and the 7805 with their real pin numbers). Case 7 must include its `decouples` hints (SPEC 6.4). Give hints only where SPEC 15 allows them.
- **Cases 11 and 12:** the owner has not supplied hardware projects, so use the substitutes in SPEC 15. Case 11 is an Arduino Uno with an I2C 16x2 LCD, a DHT22, a buzzer and a push button, about 30 parts once supporting parts are counted. Case 12 is an ESP32 with a MOSFET LED-strip driver, a buck converter module and a status LED. If the owner gives you real projects before you freeze, use those instead.
- **Modules and breakouts** (ESP32-DevKitC V4, Arduino Uno R3, LCD backpack, sensor boards) must carry real pin numbers, names and aliases from the manufacturer's documentation (SPEC 7.3). Record the source URL and board revision in the part's `props` (or a `source` field if SPEC 6.5 gives one). Check every pin against the documentation, and never guess.
- **Edit scripts** (SPEC 15): for each of cases 3, 5, 7 and 11, write four separate scripts:
  1. change one value to a text 3 times longer;
  2. add a part on an existing net;
  3. remove a part;
  4. change one IC's pin sides.

  Use the operation names and fields of SPEC 11.3, one JSON file per script.
- Where the spec uses a field the current loader does not support yet (hints, modules, a symbol type not in `library.ts`), follow the spec anyway and note it in `AUTHOR-NOTES.md`. These are frozen *inputs* for Phase 0b, and the engine will grow to read them.
- **`check-cases.ts`:** run with `npx tsx phase0/check-cases.ts`. It loads each case through `src/core` (parse and validate). For each case it prints: loads OK, or the validator's errors; symbol types not yet in the library; and the part and net count. Do not create any `*.test.ts` file, because `npm test` belongs to agent A for now.
- **Freezing:** when every case is final, write `MANIFEST.sha256` (with `node:crypto`, from a script, not by hand) and commit. After that, no frozen file changes. A correction goes into a new file plus a note in `AUTHOR-NOTES.md`.

## Task 2: the layer 6 blind-judge kit (`phase0/judge/`)

The judges are fresh Claude agents who never saw the code. They get shuffled images from our engine and from the baselines (SKiDL, netlistsvg, schemdraw), a written rubric and the netlist, and they rate them. Several judges must agree. The owner's ratings later calibrate them.

- **`RUBRIC.md`:** a 1 to 5 scale where 4 means "would publish", anchored to SPEC 9.1 and to drafting convention. Include a short checklist (correct connections, crossings, flow direction, supply up and ground down, label placement, spacing, symmetry, junction dots) and two modes: an absolute rating per image, and a pairwise "which would you publish?". A judge must first check the drawing's connections against the netlist, and an incorrect drawing scores 1 (SPEC 15).
- **`JUDGE-PROMPT.md`:** the exact prompt given to each judge agent, with placeholders for the rubric, netlist and image paths, and the JSON answer format.
- **`blind-pack.ts`:** input is a folder of PNGs named `<tool>__<case>.png`. Output is a pack folder of anonymised, shuffled copies (`img-01.png`, ...) plus `key.json` mapping each back to its tool and case. Use a seeded shuffle and record the seed. Put the key in a separate `sealed/` folder that is not given to judges.
- **`tally.ts`:** reads several judges' JSON answers and the key. It reports per-image mean and spread, agreement between judges (share of pairwise rankings that agree, or a simple statistic you justify), per-tool and per-case results, and the SPEC 15 gate figures (4+ counts, wins against the best baseline).
- **No new npm dependencies;** use `node:` built-ins only, and leave `package.json` alone. Test the kit end to end with throwaway PNGs you generate yourself, and do not rate any engine output.
- **Stretch, only if both tasks are done:** a `phase0/baselines/` folder with pinned-version setup instructions and generator scripts for SKiDL, netlistsvg and schemdraw on the 12 cases. Before installing anything, list what you would install and ask the owner.

## Ground rules

- Write only under `phase0/` (create it). Do not modify `SPEC.md`, `src/`, `tests/`, `cases/`, `docs/` or `package.json`. If the spec is wrong or unclear, write it in `phase0/AUTHOR-NOTES.md`, and agent A will fold it into the spec.
- Commit only your own folder: `git add phase0` then `git commit -m "..." -- phase0`. Never `git add -A`, never push, never rewrite history. If git reports `index.lock`, wait a few seconds and retry. Do not delete the lock. End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Check your own work before calling it done: run `check-cases.ts`, run the judge kit on dummy images, and reread every module's pins against its documentation.

## Done means

- 12 cases under `phase0/cases/` (8 validation, 4 test) and 16 edit scripts, all reported by `check-cases.ts`, with every known gap listed in `AUTHOR-NOTES.md`.
- `MANIFEST.sha256` written and committed.
- The judge kit runs end to end on dummy images.
- `phase0/HANDOFF.md` written for agent A and the owner: what was built, what is frozen, the commit hashes, open questions, and which symbol types and modules Phase 0b must add for the cases to load.
