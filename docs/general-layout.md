# The general layout, and how to improve it

Most circuits have no template. They are drawn by the **general layout**: a set of rules that
work from the netlist alone. This page says what those rules are, how their result is measured,
and which jobs are open. If you want to make drawings better and do not know where to start,
start here.

## The benchmark

`bench/circuits/` holds 18 everyday circuits: a common-emitter amplifier, a 555 timer, a
regulator, a microcontroller board, a comparator driving a motor, and so on. Almost none of them
has a template, so they show what the general rules can do.

```
npm run bench
```

draws them all, scores each drawing and compares with `bench/baseline.json`. A **lower score is
better**. The score (`scripts/lib/bench-score.ts`) adds up crossings, bends, wire length, broken
drafting conventions, broken readability limits, active parts drawn backwards and inputs drawn
left of their driver. The images go to `out/bench/`, with a page to look at them:
`out/bench/index.html`.

| Command | What it does |
|---|---|
| `npm run bench` | Draw, score, compare with the baseline. |
| `npm run bench -- ce-amp ne555` | Only the circuits whose names start with these. |
| `npm run bench -- --check` | Exit 1 if any circuit scores worse than the baseline. |
| `npm run bench -- --update` | Write the scores as the new baseline. |
| `npx tsx scripts/bench-sheet.ts` | One image of all the drawings: `out/bench/sheet.png`. |
| `npx tsx scripts/bench-debug.ts mcu` | Where each part of one circuit landed, and the layout's notes. |
| `npx tsx scripts/edit-sweep.ts` | The random-edit stability figures (which edits moved untouched parts). |

The score is a guide, not a judge. A drawing can score lower and look worse. **Always open the
image.** Update the baseline only when you have looked at every drawing that changed.

Two blind AI judges compared the old and new drawing of every bench circuit, shuffled and unlabelled, on 2026-11-11. One preferred the new drawing in 17 of 18 pairs with one tie; the other in 16, with one tie and one marginal vote for the old emitter follower. Mean marks out of 5: old 2.2 and 1.9, new 3.9 and 3.8. Their most common complaints about the new drawings are the first five open jobs below.

Where it stands (2026-11-10):

| | Valid drawings | Total score |
|---|---|---|
| Before the general-layout work | 8 of 18 | 2118.1 |
| After | 18 of 18 | 1167.1 |

## How the general layout works

Four files, in the order the layout uses them. Each has a long comment at its top.

1. **Supply symbols** (`src/layout/ports.ts`). A named power or ground net is drawn with supply or
   ground symbols, one at each pin. The one exception is a two-pin net with a battery or source on
   it, which stays a wire so a simple loop still looks like a loop.

2. **Vertical stacks** (`src/layout/stacks.ts`). Two-pin parts that an engineer draws in one
   vertical line are found from the netlist:
   - the parts between a transistor's collector (or drain) and the supply stand above it, the
     parts between its emitter (or source) and ground hang below it, and a second branch on the
     same pin (a bypass capacitor, a flyback diode) stands beside the first;
   - a string of two-pin parts from a supply down to ground stands in one column (a 555's timing
     resistors and capacitor);
   - a chain of two-pin parts strictly in series that ends at ground hangs in one line.

   A stack is rigid: its parts move together. A locked or hinted part never joins one, and in an
   edit a part the edit did not touch joins one only where it already stood.

3. **Flow** (`src/layout/flow.ts`). This decides the left-to-right order. Some connections have a
   direction that follows from the parts: an op-amp's inputs are upstream of it, a transistor is
   driven at its base or gate, a regulator feeds the rail on its output. The other connections take
   their direction from where the drawing starts: a source, an input connector, a potentiometer, or
   failing those the part furthest from the outputs (LEDs, motors, buzzers, connectors labelled
   OUT). Each block's column is then its longest path from the start. A feedback part takes its
   amplifier's column. A pull-up, a shunt capacitor or a small stack on one wire sits half a column
   from that wire's blocks, on the input side when it only feeds inputs.

4. **Pin order** (the end of `src/layout/layout.ts`). The pins on the left and right of a chip's
   box are put in the order of what they connect to. The layout runs a second time with that order
   and keeps the result only if it has fewer crossings, then fewer bends, then less wire.

Templates still win. A circuit a template recognises is drawn by the template, and the general
rules lay out the rest around it. The three small templates (pull-up, pull-down, LED with its
resistor) give way to a stack, because a stack draws them the same way and also knows where they
belong.

When a voltage divider tap has at least two additional terminals, its template places the
lower resistor two grid units to the right of the upper resistor. A wire can then pass
straight through two T junctions, as in `ce-amp`, `follower`, and `mixer-ce`.

Each rule has a fallback. If a drawing with stacks cannot be solved, routed or verified, the
layout runs again without them (`stacks: false`), and the notes say so.

## Open jobs

Each job names the bench circuit that shows the problem. A job is done when that drawing looks
right, the bench total does not rise, and `npm run typecheck`, `npm test` and `npm run phase0`
pass. Layout engine changes need an agreed issue first (see `AGENTS.md`).

| Job | Seen in | What is wrong today | Where to work |
|---|---|---|---|
| Negative supplies | `pushpull` | `VEE` and names like `-12V` are not known as supplies, so the lower transistor's rail is a wire and the transistor ends up at the top. A negative supply needs a symbol that points down, and stacks must hang towards it. | `src/core/model.ts` (`netKind`), `src/layout/layout.ts` (port symbols), `src/layout/stacks.ts` (`rail`) |
| Fan-out from a chip | `shift`, `mcu` | Several tall branches (resistor and LED) driven by neighbouring pins share one column, so their wires step around each other. Draw each branch along its pin's row, or stagger them. | `src/layout/flow.ts`, the column ordering in `src/layout/layout.ts` |
| Regulators | `regulator`, `sensor-node` | A three-terminal regulator has IN and OUT side by side on top. IN belongs on the left and OUT on the right, with the rail drawn as a wire through it. Pull request 7 (series supply path) is the start; it needs rebasing on this engine. | `icFor` in `src/layout/layout.ts`, `grok/power-path` |
| Long labels widen columns | `sensor-node` | A module's long title pushes its whole column apart. Wrap or shorten the title, or let it overhang. | `labelFor` in `src/layout/layout.ts` |
| Symmetric circuits | `multivibrator`, `inamp` | Drawn left to right, valid but not in their textbook shape. These are template jobs. | `src/layout/templates/library.ts`, `docs/templates.md` |
| Edit stability | `npx tsx scripts/edit-sweep.ts` | 131 of 137 random edits are stable (the gate is 95%). Two of the six failures are a longer label pushing the next column 8 G. | `src/layout/layout.ts` (incremental mode) |
| Speed | `npm run gates`, gate 6 | The generated 30-part circuit takes about 2.9 s for layout plus checked fixes; the limit is 3 s. A failed fix runs the whole fallback chain. | `src/layout/layout.ts` (the `retry` chain), `src/edit/findings.ts` |
| More bench circuits | - | The corpus has no crystal oscillator, switching converter or relay logic, because their symbols are in open pull requests 2 to 4. Add circuits as the symbols land. | `bench/circuits/` |
| Calibrate the score | - | The weights in `scripts/lib/bench-score.ts` are judgement. Compare the scores with blind ratings and adjust. | `scripts/lib/bench-score.ts` |

## Adding a bench circuit

Put a circuit file in `bench/circuits/` (the format is in `docs/netlist-format.md`), run
`npm run bench`, look at the drawing, and add its score with `npm run bench -- --update`. Use
circuits people really draw. A circuit that draws badly is more useful here than one that draws
well: it becomes the next job.
