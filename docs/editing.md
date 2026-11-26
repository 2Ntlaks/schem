# Editing a circuit file

`schem edit` changes a `.schem` text file ([`dsl.md`](dsl.md)) or `.schem.json` file ([`netlist-format.md`](netlist-format.md)) and redraws it **without reshuffling the drawing**: the parts
you did not touch stay where they were. Use it (or the MCP `schem_edit` tool) instead of editing the file by hand when the
drawing is already in a report, a slide or a conversation and should not jump around.

```sh
npm run schem -- edit examples/esp32-relay.schem.json --ops add-led.json
```

```
esp32-relay: edit saved (drawing kept). Wrote examples/esp32-relay.schem.json, out/esp32-relay.svg and out/esp32-relay.png (121 ms)
  changed: parts D9, R9, U1; nets n1, n10, n2, n3, n9
  untouched: 6 parts moved 0 G on average and 0 G at most; other nets rerouted: none
  revision: 08adf5e6...
  layout: c3f334a3...
```

`add-led.json` lists the operations, applied in order as one change:

```json
{
  "ops": [
    { "op": "addPart", "part": { "id": "D9", "type": "led", "props": { "color": "green" } } },
    { "op": "addPart", "part": { "id": "R9", "type": "resistor", "props": { "value": "330" } } },
    { "op": "connect", "endpoints": ["U1.IO25", "R9[1]"], "name": "STATUS" },
    { "op": "connect", "endpoints": ["R9[2]", "D9[A]"] },
    { "op": "connect", "endpoints": ["D9[K]", "Q1[E]"] }
  ]
}
```

A bare list of operations (`[ {...}, {...} ]`) works too.

<!-- checked: src/cli.ts edit(), src/io/edit-script.ts parseEditScript() -->

## What happens

1. The operations are applied in order. If any one of them fails (an unknown part, a pin that
   does not exist, a part id that is already taken), **nothing changes**: the whole edit is
   refused.
2. The circuit is laid out again, starting from the drawing you last saw. Only the parts and nets
   the edit involved are free to move; the rest keep their places.
3. The new drawing is checked like every drawing: connections rebuilt from the picture and
   compared with the netlist, and overlaps. **Only a valid drawing is saved.**
4. The file is saved, the previous version is copied to `.schem-history/` next to it, and the SVG
   and PNG are written to `out/` (change it with `-o <folder>`).

For `.schem.json` files, the saved file is written in full form: endpoints sorted, the default
`intent` and `assets` fields filled in, and a `layout` section that holds the drawing. For `.schem`
text files, declarations are formatted cleanly (ordinary comments are dropped) and the drawing is
stored in a trailing `# schem-layout:` comment. That saved layout is how the next `draw` or `edit`
keeps the same drawing. Do not edit it by hand; if you change the circuit by hand, schem notices
that the layout no longer matches and draws the file afresh. Use `schem undo <file>` (or MCP
`schem_undo`) to restore the latest snapshot from `.schem-history/`.

<!-- checked: src/edit/edit.ts edit() (D4: saved only if valid), src/io/layout-cache.ts (basis check), src/cli.ts snapshot() -->

## How much may the rest move?

Sometimes a change cannot be drawn well without nudging its neighbours. schem measures how far
the untouched parts moved, after taking out any shift of the whole sheet, in grid units (`G`, one
grid step, 0.1 inch). The limit is:

- untouched parts move at most 2 G on average, and no single one more than 6 G;
- no untouched part turns or flips;
- at most one net the edit did not involve is rerouted;
- a locked part never moves.

On 137 random test edits, 134 stay inside this limit (97.8%). When an edit goes past it, schem
still saves it and says so:

```
  warning: this edit moves untouched parts more than the limit (an untouched part moved 8 G (at most 6)). It is saved anyway; --strict refuses such edits.
```

With **`--strict`**, such an edit is refused instead and nothing is written. That is the option
for an agent or a script that must never move parts the user did not ask about. To redraw the
whole sheet on purpose, add `{ "op": "relayout", "mode": "canonical" }` to the operations.

<!-- checked: src/edit/report.ts stabilityBreaks(), tests/edits.test.ts (random-edit sweep) -->

## Options

| Option | What it does |
|---|---|
| `--ops <file>` | the operations to apply (required) |
| `-o <folder>` | where to write the SVG and PNG (default `out`) |
| `--strict` | refuse an edit that moves untouched parts more than the limit |
| `--dry-run` | apply and check the edit, report what would happen, write nothing |
| `--json` | print the result as JSON, for agents and scripts |
| `--expect-revision <R>` | refuse the edit if the circuit or hints changed since revision `R` |
| `--expect-layout <L>` | refuse the edit if the drawing changed since layout token `L` |

Every saved edit prints a `revision` (a fingerprint of the circuit and hints) and a `layout`
token (the same, plus the drawing). An agent that edits in several steps can pass them back with
`--expect-revision` and `--expect-layout`: if someone else changed the file in between, the edit
is refused with exit code 4 instead of overwriting their work. The ops file may also carry them
as `expectedRevision` and `expectedLayout`.

**Exit codes:** `0` saved (or checked, with `--dry-run`), `1` invalid or refused and nothing
written, `2` usage error (or unreadable JSON input in plain-text mode), `3` internal error, `4`
conflict (write lock or the file changed since the expected revision or layout).

<!-- checked: src/cli.ts dispatch() and edit() -->

## Operations

Pins are written as in a circuit file: `R1[2]`, `U1.SDA`, `U1{GND}`. See [`dsl.md`](dsl.md) and
[`netlist-format.md`](netlist-format.md).

**Circuit operations** change what is connected:

| Operation | Fields | What it does |
|---|---|---|
| `addPart` | `part: { id, type, props? }` | adds a part; the id must be new. Boards (`module:...`) get their pins from the library |
| `removePart` | `part` | removes a part, its connections, and the hints and lock that named it |
| `renamePart` | `from`, `to` | renames a part everywhere |
| `setProp` | `part`, `key`, `value` | sets a property such as `value` or `partNumber`; `null` removes it |
| `connect` | `endpoints`, `name?` | connects pins; nets they are already in are joined into one |
| `disconnect` | `endpoint` | takes one pin out of its net |
| `mergeNets` | `nets`, `keep` | joins nets, keeping the name of `keep` |
| `renameNet` | `net`, `name` | gives a net a new name |
| `setNoConnect` | `terminal`, `nc` | marks a pin as deliberately unconnected (`nc: true`) or not |

**Drawing operations** change how it looks, never what it means. Each one sets a value, so
sending the same operation twice gives the same file:

| Operation | Fields | What it does |
|---|---|---|
| `setOrientation` | `part`, `rot`, `flip?` | turns a part to 0, 90, 180 or 270 degrees, optionally mirrored |
| `setLabelSide` | `part`, `side` | puts its labels `above`, `below`, `left` or `right` |
| `setPinSides` | `part`, `left?`, `right?`, `top?`, `bottom?` | chooses which side of a chip or board each pin is on |
| `place` | `part`, `rel`, `of` | asks for `part` to be `right-of`, `left-of`, `above` or `below` another |
| `align` | `axis`, `parts` | asks for parts to share a `row` or a `column` |
| `lock` / `unlock` | `part`, `at?` | pins a part where it is (or at `at: [x, y]`), or frees it |
| `removeHint` | `id` | removes the hint a `place`, `align`, `setOrientation` or `setPinSides` made, by its id (`h1`, `h2`, ... in the file's `intent.hints`) |
| `setSpacing` | `factor` | spreads the whole sheet out, from 1 (default) to 4; redraws the whole sheet |
| `relayout` | `mode` | `canonical` redraws the whole sheet from scratch |

`place` and `align` take an optional `priority`. The full rules of each operation are in
[`SPEC.md`](../SPEC.md), section 11.3.

<!-- checked: src/io/edit-script.ts OPS, src/core/ops.ts applyOps(), src/edit/edit.ts applyVisual() -->
