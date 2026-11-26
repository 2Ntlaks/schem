# Layout benchmark

This folder holds the general-layout benchmark for `schem`.

- [`circuits/`](circuits/): 18 everyday benchmark circuits (`*.schem.json`), such as a common-emitter amplifier, a 555 timer, a linear regulator, a Schmitt trigger, and a microcontroller board. Most have no layout template, so they measure the general placement and routing rules.
- [`baseline.json`](baseline.json): saved reference scores for each circuit. Lower scores are better. The scoring formula lives in [`../scripts/lib/bench-score.ts`](../scripts/lib/bench-score.ts).

## Commands

Run from the repository root:

```sh
npm run bench                       # draw all 18 circuits, score them, and compare with baseline.json
npm run bench -- --check            # exit 1 if any circuit scores worse than baseline.json or fails to draw
npm run bench -- --update           # write the current scores into bench/baseline.json
npm run bench -- ce-amp ne555       # run only circuits whose names start with these prefixes
npx tsx scripts/bench-sheet.ts      # combine out/bench/*.png into out/bench/sheet.png
npx tsx scripts/bench-debug.ts mcu  # print part positions, blocks, and layout notes for one circuit
```

## Visual review

Drawings are written to `out/bench/` along with `out/bench/index.html` for side-by-side review. A lower numeric score does not prove a drawing looks better: always open the PNGs and inspect every circuit that changed before running `--update`.

For how the general layout engine works and the list of open layout jobs, read [`../docs/general-layout.md`](../docs/general-layout.md).
