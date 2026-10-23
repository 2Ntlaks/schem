# Judge prompt

This is the exact prompt given to each judge agent. `blind-pack.ts --judges N` fills in the placeholders and writes one prompt per judge to `<pack>/prompts/judge-NN.md`. Each judge gets the items in its own seeded order. Placeholders:

| Placeholder | Filled with |
|---|---|
| `{{JUDGE_ID}}` | `judge-01`, `judge-02`, ... |
| `{{PACK_DIR}}` | absolute path of the pack folder (never the `sealed/` folder) |
| `{{PACK_ID}}` | the pack id from `pack.json` |
| `{{RUBRIC}}` | the full text of `RUBRIC.md` |
| `{{ABSOLUTE_ITEMS}}` | one line per image: image path and the netlist file for its circuit |
| `{{PAIRWISE_ITEMS}}` | one line per pair: pair id, image A, image B, netlist file |
| `{{ANSWER_PATH}}` | where the judge writes its JSON answer |

Run each judge as a **fresh agent** with no other context: it must not see the code, the repository, the sealed key, or other judges' answers. Give it read access to `{{PACK_DIR}}` and write access to `{{ANSWER_PATH}}` only.

The prompt starts below the line.

---

You are {{JUDGE_ID}}, one of several independent judges rating schematic drawings. You work alone. Do not look for, open or guess at anything outside the folder `{{PACK_DIR}}`, and do not try to find out which program made which drawing; the drawings are anonymised and shuffled on purpose.

Read the rubric below carefully, then rate every item. Open each image file to look at it (view the PNG), and read the netlist file named on the same line. Follow the rubric's step 1 for **every** image: check every net in the netlist against the drawing before you judge its looks. An incorrect drawing scores 1.

Work through the items in the order given. Rate each image on its own merits; do not compare images of the same circuit in the absolute part, and do not change an earlier rating after seeing a later image.

<rubric>
{{RUBRIC}}
</rubric>

## Part 1: absolute ratings

Rate each image from 1 to 5.

{{ABSOLUTE_ITEMS}}

## Part 2: pairwise choices

For each pair (two drawings of the same circuit), say which you would rather publish.

{{PAIRWISE_ITEMS}}

## Your answer

Write **one JSON file** to `{{ANSWER_PATH}}`, UTF-8, with exactly this shape and nothing else in the file:

```json
{
  "judge": "{{JUDGE_ID}}",
  "pack": "{{PACK_ID}}",
  "absolute": [
    {
      "image": "img-01.png",
      "connections": { "correct": true, "errors": [] },
      "checklist": {
        "connections": "good", "overlaps": "good", "supplyGround": "minor", "flow": "good", "crossings": "good",
        "junctions": "good", "labels": "minor", "spacing": "good", "symmetry": "n/a", "wiring": "good"
      },
      "score": 4,
      "notes": "One or two sentences: the main reason for the score."
    }
  ],
  "pairwise": [
    { "pair": "pair-01", "choice": "A", "reason": "One sentence naming the deciding difference." }
  ]
}
```

Rules for the answer:
- One `absolute` entry for every image in part 1, and one `pairwise` entry for every pair in part 2, using the ids exactly as given.
- `score` is an integer 1-5. If `connections.correct` is `false`, `score` must be 1 and `connections.errors` must list each error (for example `"net SDA: R1 pin 2 not connected"`, `"VOUT joined to GND at the op-amp output"`).
- Every checklist value is one of `"good"`, `"minor"`, `"major"`, `"n/a"`.
- `choice` is `"A"`, `"B"` or `"tie"`.

When the file is written, reply with one line: the number of images and pairs you rated.
