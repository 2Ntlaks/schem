# Test fixtures: the contract

These fixtures are written **from SPEC.md alone**, independently of the implementation in `src/`. They are the black-box check that the engine does what the spec says. The implementation must not change a fixture to make it pass; if a fixture is wrong, the spec section it cites decides, and the fixture is fixed with a note.

All coordinates are integer grid units (`G`). Origin top-left, y grows downward.

## Common pieces

**Circuit** (SPEC 6.3, 6.5 `circuit`):

```json
{
  "parts": [ { "id": "R1", "type": "resistor" } ],
  "nets": [ { "id": "n1", "name": "PWR", "kind": "power", "domain": null, "endpoints": ["R1[1]", "U1{GND}"] } ],
  "nc": ["U1[12]"]
}
```

- `name`, `kind`, `domain` are optional. `kind` defaults per SPEC 6.3 (name-based), else `signal`.
- Endpoints are canonical: `Part[number]` for a terminal, `Part{GROUP}` for a group. Model fixtures may also use the name forms `Part.NAME` (SPEC 6.2), which the implementation must resolve.

**Pin definitions** (the logical inventory, SPEC 6.2). Fixtures do not depend on the built-in symbol library: every part's pins are given explicitly.

```json
"pinDefs": {
  "R1": [ { "number": "1", "name": "1", "role": "passive" }, { "number": "2", "name": "2", "role": "passive" } ],
  "U1": [ { "number": "14", "name": "GND", "role": "ground", "group": "GND" }, { "number": "29", "name": "GND", "role": "ground", "group": "GND" } ]
}
```

Optional pin fields: `aliases` (array), `group`, `iface`.

## Verifier fixtures: `verifier/*.json` (SPEC 9.7)

A circuit plus a **render model** (what is drawn), and the expected verdict.

```json
{
  "name": "dotless-t-unsplit",
  "specRef": "9.7",
  "description": "A T junction without a dot, trunk drawn as one segment.",
  "circuit": { "...": "..." },
  "pinDefs": { "...": "..." },
  "render": {
    "pins":     [ { "part": "R1", "number": "1", "at": [0, 0], "dir": "left" } ],
    "keepouts": [ { "part": "R1", "x": 0, "y": -1, "w": 6, "h": 2 } ],
    "wires":    [ [[0,0],[-4,0],[-4,6]] ],
    "dots":     [ [-4, 3] ],
    "ports":    [ { "at": [-4, 6], "text": "GND", "domain": null, "kind": "ground" } ],
    "ncMarks":  [ { "part": "U1", "number": "12" } ]
  },
  "expect": { "valid": false, "errors": ["ambiguous-t"] }
}
```

- `render.pins`: only pins that are **drawn**. A pin in `pinDefs` but not here is hidden. `dir` is the side a wire leaves the pin: `left`, `right`, `up`, `down` (up = towards smaller y).
- `render.keepouts`: routing keep-out boxes (SPEC 7.1). `x, y` is the top-left corner. Pin anchors lie on the boundary. Optional; when absent, keep-out rules are not tested.
- `render.wires`: polylines; every segment is horizontal or vertical. Router segmentation is arbitrary: the verifier must normalise (SPEC 9.7).
- `render.ports`: power/ground symbols (`kind` `power` or `ground`) and net labels (`kind` `label`), each with its anchor, its **visible text** and domain mark.
- `render.ncMarks`: no-connect crosses drawn at pins.
- `expect.valid`: the verdict.
- `expect.errors`: error codes that **must** appear (the implementation may report more). Empty list for valid fixtures.

**Verifier error codes**

| Code | Meaning (SPEC 9.7 / 9.1) |
|---|---|
| `topology-mismatch` | Connected groups rebuilt from the drawing differ from the circuit's nets |
| `ambiguous-t` | Three conductor directions meet with no dot |
| `four-way-junction` | Four directions meet with a dot |
| `dot-degree` | A dot where fewer than three directions meet |
| `pin-side-entry` | A conductor ends at a pin anchor arriving from a direction other than the pin's `dir` |
| `pin-pass-through` | A conductor passes through a pin anchor |
| `dangling` | A conductor end touches nothing |
| `port-off-wire` | A port or label anchor not on a conductor end or pin anchor |
| `missing-endpoint` | A net endpoint is not drawn, or drawn but not attached |
| `hidden-connected` | A pin in a net (or marked no-connect) is not drawn |
| `nc-not-marked` | A no-connect terminal is drawn without its mark |
| `nc-attached` | Something is attached to a no-connect terminal |
| `wire-in-keepout` | A unit wire edge has its midpoint inside or on a keep-out box (part, port or label; SPEC 9.1 rule 4) |
| `pin-contact` | Two pin anchors at the same point (rev C.1) |
| `non-orthogonal` | A diagonal or off-grid conductor (rev C.1) |
| `unconnected-attached` | Something is attached to a drawn pin that is in no net as written (rev C.1) |
| `port-mismatch` | A port's text, domain or symbol class does not match its net, or a port is on an unnamed net (rev C.1) |

## Model fixtures: `model/*.json` (SPEC 6.2-6.4, 6.9)

A circuit (which may be invalid), optional edit operations, and the expected outcome.

```json
{
  "name": "group-member-in-second-net",
  "specRef": "6.2",
  "description": "U1{GND} in n1 and U1[14] (member of GND group) in n2 must be rejected.",
  "circuit": { "...": "..." },
  "pinDefs": { "...": "..." },
  "ops": [],
  "expect": { "ok": false, "errors": ["E222"] }
}
```

- `ops` (optional): circuit operations from SPEC 11.3, applied in order as one transaction: `connect {endpoints, name?}`, `disconnect {endpoint}`, `mergeNets {nets, keep, sameSupply?}`, `renameNet {net, name}`, `setNoConnect {terminal, nc}`, `renamePart {from, to}`, `removePart {part}`, `addPart {part: {id, type}, pins: [...]}`.
- `expect.ok`: whether the circuit (after the ops) is accepted.
- `expect.errors`: codes that must appear when `ok` is false.
- `expect.nets` (optional, when `ok` is true): the resulting nets, compared as a set. Each entry: `{ "id"?, "name"?, "kind"?, "domain"?, "endpoints": [...] }`; only the fields given are compared; endpoints compared as a set of canonical endpoints.
- `expect.equal` (optional): for `circuitEquals` fixtures, give `"circuitB"` (and `"pinDefsB"` if different) and `"equal": true|false`.

**Model error codes**

| Code | Meaning |
|---|---|
| `E104` | Unknown pin |
| `E106` | Ambiguous pin name (matches terminals not in one group) |
| `E220` | Equivalence class in two nets |
| `E222` | Group member and its group (or two members of one group) in different nets |
| `E223` | No-connect terminal is in a net |
| `E224` | No-connect on a group endpoint |
| `E225` | Group endpoint whose members are all no-connect (no representative) |
| `E230` | Merge of a power net with a ground net |
| `E231` | Merge of nets with different domains |
| `E232` | Merge of two different named power nets without `sameSupply` |
| `E233` | Merge of differently named nets without `keep` |
| `E240` | Duplicate net name |
| `E241` | Net with no endpoints |
| `E250` | Duplicate part id |
| `E251` | Unknown part in an endpoint |
