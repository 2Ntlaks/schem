# Schematic rating rubric (verification layer 6)

You are rating schematic drawings for a technical reader: a blog post, a report, a thesis. Each drawing claims to show one circuit, and you are given that circuit's netlist. You do not know which program drew which image, and it does not matter: rate only what you see.

The question behind every score is: **would you publish this drawing as it is?**

## Step 1: check the connections first

Before you judge how a drawing looks, check that it shows the netlist exactly (SPEC 15: "an incorrect drawing scores 1").

1. For every net in the netlist, find each of its endpoints in the drawing and confirm they are joined by wires, junction dots, or matching supply, ground or net-label symbols.
2. Check that nothing else is joined: no two nets touch, no wire passes through a pin, no T junction without a dot is used as a connection, and wires that cross without a dot are not connected.
3. Check every part is present with its reference (R1, U2 ...) and its value or part name, and that pins on chips and boards carry the names or numbers needed to tell which pin a wire reaches.
4. Supply and ground symbols count as connections only between symbols with the same name. A ground symbol with no text is the default `GND`.

If **any** connection is missing, extra or wrong, or a part is missing, the drawing is **incorrect**: set `connections.correct` to `false`, list what is wrong in `connections.errors`, and give **score 1**, however good it looks. A connection you cannot read with confidence (illegible, ambiguous junction, overlapping text hiding a pin) also counts as an error: a reader would not be able to trust it either.

## Step 2: score 1 to 5

| Score | Meaning | Typical signs |
|---|---|---|
| **5** | Excellent. Publish as is; looks hand-drafted by a careful engineer. | Every convention below holds; nothing you would move. |
| **4** | **Would publish.** Good, conventional and clear; at most a nit you would not bother fixing. | All checklist items good, or one minor issue that does not slow a reader down. |
| **3** | Usable but needs work. You would not publish it without fixing something. | Several minor issues, or one major issue (for example a needless crossing tangle, ground drawn upwards, labels you have to hunt for). |
| **2** | Poor. Hard to read; a reader must trace wires carefully to understand it. | Several major issues: flow reversed or scattered, wires wandering around parts, crowded or overlapping text. |
| **1** | Unacceptable or **incorrect**. Wrong connections (step 1), or so unclear that it cannot be read. | Any connection error; overlapping parts; unreadable. |

Scores are whole numbers. **4 is the pass mark**: give 4 or 5 only if you would put the drawing in front of readers with your name on it.

## Checklist (rate each item)

Rate each item `good`, `minor` (noticeable but harmless), `major` (hurts readability) or `n/a` (does not apply to this circuit). These are drafting conventions, in the order of SPEC 9.1.

| Key | Item | Good looks like |
|---|---|---|
| `connections` | Connections match the netlist (step 1) | Every net exactly as listed; `major` if anything is wrong (and then score 1) |
| `overlaps` | Nothing overlaps | No part, label or symbol on top of another; no wire through a part or its text |
| `supplyGround` | Supply up, ground down | Supply symbols point up and sit above the circuit; ground symbols point down and sit below; parts between supply and ground stand vertical |
| `flow` | Signal flow | Inputs on the left, outputs on the right; a chain of parts on one signal path in a straight line where possible |
| `crossings` | Few crossings | No crossing that a different arrangement would obviously avoid |
| `junctions` | Junctions | Every T junction has a dot; no four-way junctions; no dots where wires only cross |
| `labels` | Labels | Each reference and value right next to its part, upright, readable, not colliding with wires; pin names on chips readable |
| `spacing` | Spacing and alignment | Even spacing, parts aligned in rows and columns, no cramped corners, no large empty areas, wires on a tidy grid |
| `symmetry` | Symmetry and repeated structure | Repeated or symmetric structures (bridge, H-bridge, differential pair, identical channels) drawn as such |
| `wiring` | Wiring style | Short, straight wires with few bends; a shared net drawn as a trunk with short taps rather than many parallel wires; decoupling capacitors next to their pin |

The score is your overall judgement, not a sum. The checklist keeps you honest: a drawing with a `major` item rarely deserves 4, and one with two or more `major` items rarely deserves 3.

## Pairwise mode: which would you publish?

Some tasks show two drawings of the **same** circuit, A and B. Check both drawings' connections first (step 1). Then answer:

- `"A"` or `"B"`: the one you would rather publish. An incorrect drawing always loses to a correct one.
- `"tie"`: only if they are genuinely equal, both correct or both incorrect.

Give a one-sentence reason naming the deciding difference.

## Things to ignore

- Which program or style produced the drawing, and whether it looks familiar.
- Colour scheme, line weight and font choice, unless they hurt legibility.
- Symbol style (IEEE zigzag or IEC box resistor): both are acceptable if used consistently.
- Image size and margins, unless the drawing is cropped or tiny.
- The netlist's net names on wires: a drawing does not need to show the names of signal nets, but supply and ground symbols must show theirs.
