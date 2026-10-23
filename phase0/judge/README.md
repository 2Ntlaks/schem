# Layer 6 blind-judge kit

Fresh Claude agents, who never saw the code, rate shuffled and anonymised drawings from our engine and from the baselines (SKiDL, netlistsvg, schemdraw). Several judges rate each drawing, and their agreement is measured. The owner's blind ratings then calibrate them (SPEC 13 item 3a, SPEC 15 gates 2, 3 and 5; `docs/verification-stack.html` layer 6). node: built-ins only.

| File | What it does |
|---|---|
| `RUBRIC.md` | 1-5 scale (4 = "would publish") anchored to SPEC 9.1. Connections are checked first, and an incorrect drawing scores 1. A ten-item checklist. Absolute and pairwise modes. |
| `JUDGE-PROMPT.md` | the exact prompt for each judge agent: placeholders and the JSON answer format |
| `blind-pack.ts` | PNG folder to blind pack: shuffled `img-NN.png` copies with metadata stripped, plain-text netlists, `pack.json`, one filled prompt per judge, and the key in a separate `sealed/` folder |
| `tally.ts` | judges' answers + key to report: per image, per tool, per case, agreement, SPEC 15 gate figures, calibration against the owner |
| `selftest.ts` | end-to-end test on throwaway images and simulated answers; checks determinism, anonymity, metadata stripping, answer validation and the statistics |
| `lib.ts` | seeded shuffle (mulberry32), PNG chunk stripping, small statistics |

## Running a panel

1. **Render** every case with every tool to PNG, named `<tool>__<case>.png`, all in one folder, for example `schem-noedit__case03.png`, `schem-edit__case03.png`, `netlistsvg__case03.png`, `skidl__case03.png`, `schemdraw__case03.png`. `<case>` starts with `caseNN`; anything after it is ignored.
2. **Pack:**
   ```
   npx tsx phase0/judge/blind-pack.ts --in renders/ --out panel-01/ --judges 3 --ours schem
   ```
   The pack records the seed (pass `--seed N` to reproduce one). `--ours` lists our tools, by exact name or as `name-stage`. `--pairs ours` keeps only ours-vs-baseline pairs (`all` is the default; `none` skips pairwise mode). The output is:
   - `panel-01/pack/`: give this folder to the judges.
   - `panel-01/sealed/key.json`: the key. **Never** show it to a judge.
   - `panel-01/answers/`: where the judges write their answers.
3. **Judge:** start one fresh agent per prompt in `panel-01/pack/prompts/`, with the prompt file's text as its whole task. Each judge reads only `pack/` and writes `answers/judge-NN.json`. Judges get the items in different seeded orders. A second model family (for example GPT through Codex) can be one of the judges; its answer file has the same shape.
4. **Tally:**
   ```
   npx tsx phase0/judge/tally.ts --dir panel-01/ [--owner owner.json] [--json panel-01/report.json] > panel-01/report.md
   ```
5. **Owner calibration:** the owner rates the same `pack/` blind, using the rubric, into a file of the same shape (pairwise part optional), and passes it with `--owner`. The report then gives each judge's distance from the owner and lists the images where the panel and the owner disagree on "would publish". Use those to tighten `RUBRIC.md`, then re-run the panel on a fresh pack. Do not reuse the rated images to tune the rubric and then report on them.

## How the numbers are defined

- **Panel score** per image = the median of the judges' scores, after forcing 1 for any drawing a judge marked incorrect. The median is robust to one outlying judge.
- **Within-case order agreement** (the main agreement figure): for each two judges, and each two drawings of the same circuit that both judges scored differently, the share ordered the same way. It answers the question gate 5 asks (is ours at least as good as the baseline on this circuit?), and a judge who is harsher across the board does not lower it. Pairs either judge tied are counted separately.
- **Fleiss' kappa** on the "would publish" verdict (score 4+): agreement beyond chance on the decision gates 2 and 3 count. Cohen's kappa is used for each pair of raters and for each judge against the owner.
- **Gate figures** are computed for each of our tools from the panel score and, with `--owner`, from the owner's scores. SPEC 15 defines gates 2, 3 and 5 on the **owner's** ratings, so the panel rows are an estimate until calibrated. Gate 2 needs a no-edit and an after-edit rating, so render each stage as its own tool name (`schem-noedit`, `schem-edit`).

## Blindness: what the kit does and does not hide

- Hidden: tool names (file names become `img-NN.png`, and the pack holds no tool name), input order (seeded shuffle, plus a different order for each judge), and PNG metadata that names software, such as tEXt "Software", tIME, pHYs and iCCP (only IHDR, PLTE, tRNS, gAMA, cHRM, sRGB, IDAT and IEND are kept).
- Not hidden: drawing style, image size and colours. A judge who knows a tool's look may recognise it. The rubric tells judges to ignore style, and the panel should include judges who have not seen the tools' output before. Rendering every tool at the same pixel width reduces the size cue.

`npx tsx phase0/judge/selftest.ts` runs the whole kit on throwaway images (pass `--keep <folder>` to look at the pack and report). A real judge agent was also run once on a 4-image dummy pack: its answer file passed `tally.ts` with no problems, and it correctly scored the blank test images 1 as incorrect.
