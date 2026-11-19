# The circuit file format

A circuit file is JSON. It lists the parts and the nets that connect them. The engine lays the
drawing out from that description, so you do not place anything by hand.

Draw a file with:

```
npm run schem -- draw examples/led.schem.json
```

This writes `out/led.svg` and `out/led.png`, and prints one line saying whether the drawing is
valid. `-o <dir>` writes to another folder.

## The top level

A file has three main fields:

- `schema`: the format version, the string `"schem/1.0"`. It is optional, but a file that has it
  must use major version 1. Keep it in files you write.
- `meta`: an optional object. `meta.title` and `meta.created` are strings. A file saved by the
  engine also has `meta.nextNetId` and `meta.nextHintId`; both are positive integers used when
  editing.
- `circuit`: required. An object with a `parts` list and a `nets` list.

A field the engine does not know makes a warning, not an error: the file still draws, but editing
it is refused.

<!-- checked: src/io/project.ts loadProject() (TOP, schema, meta checks; W105 for unknown fields) -->

## A part

A part has:

- `id`: required. It starts with a letter and may then use letters, digits and underscores, for
  example `R1` or `U2`. Two parts may not share an id.
- `type`: required. One of the part types in `docs/parts.md`, such as `resistor`, `led`, `opamp`
  or `module:esp32-devkitc-v4`.
- `props`: optional. An object whose values are all strings, for example `"value": "470"`. The
  engine keeps the values as written; what each name means depends on the part type.
- `pins`: only for a part that declares its own pins, such as `ic` or `header`. A fixed symbol
  and a `module:` part take their pins from the library and must not have a `pins` list.

A part on its own:

```json
{ "id": "R1", "type": "resistor", "props": { "value": "470" } }
```

<!-- checked: src/io/project.ts loadProject() (part loop: PART keys, PART_ID, duplicate ids via validate(), props, pins rules) -->

## A net

A net is one connection. It has:

- `id`: required. It uses the same letters, digits and underscores rule as a part id, and two
  nets may not share an id.
- `name`: optional. A non-empty string. Two nets may not share a name.
- `endpoints`: required. A non-empty list of strings, each naming one pin.

An endpoint has three forms:

| Form | Meaning | Example |
|---|---|---|
| `R1[1]` | the pin with number `1` | a resistor terminal |
| `D1.anode` | the pin with that name, or one of its aliases | the LED anode |
| `U1{GND}` | a pin group: every pin in the group | all ground pins of a board |

The part must exist in the file, and the pin must exist on that part. A pin may be in one net
only: putting the same pin in two nets is an error.

```json
{ "id": "n2", "endpoints": ["R1[2]", "D1[A]"] }
```

<!-- checked: src/io/project.ts loadProject() (net loop, NET keys, NET_ID); src/core/validate.ts validate() (empty endpoints E241, duplicate names E240, one net per pin E220); src/core/validate.ts resolveEndpoint() (TERMINAL, GROUP, NAMED forms) -->

## Power and ground

A net is power or ground in one of two ways:

1. An explicit `kind` wins. It may be `"signal"`, `"power"` or `"ground"`.
2. Without `kind`, the net's `name` decides. Matching ignores case.

Ground names are `GND`, `AGND`, `DGND`, `PGND`, `VSS`, `0V` and `GROUND`.

Power names include `VCC`, `VDD`, `VIN`, `VBAT`, `V+`, `VPP`, `VBUS`, `PWR`, `VEE` and `V-`,
or a voltage such as `5V`, `3.3V`, `3V3`, `+12V` or `-12V`. A power net named `VEE`, `V-`
or starting with `-` has a downward supply symbol with its name underneath.
To use `VSS` as a negative supply, set its `kind` to `"power"`.

Any other name, or no name, makes the net a signal net.

<!-- checked: src/core/model.ts netKind(); src/io/project.ts loadProject() (net.kind values) -->

## Pins with no connection

`circuit.nc` is an optional list of endpoints for pins you do not want to connect, for example
`["U1[5]"]`. Each one must name a single terminal, not a group, and the same pin may not also be
in a net.

<!-- checked: src/core/validate.ts validate() (nc loop: E224 group, E223 also in a net) -->

## Optional layout hints

A file may also have an `intent` object. It can hold hints and locks that guide the layout, plus
overrides and style settings. It is optional: a file without it draws normally. The fields and
their rules are described in `SPEC.md`.

<!-- checked: src/io/project.ts loadProject() (INTENT keys; intent is optional) -->

A file saved by `schem edit` also has a `layout` section: the drawing as it was saved, so the
next draw or edit keeps it. You never write it yourself. See [`editing.md`](editing.md).

<!-- checked: src/io/layout-cache.ts, src/cli.ts draw() -->

## Worked example

`examples/led.schem.json` in full:

```json
{
  "schema": "schem/1.0",
  "meta": {
    "title": "LED with a current-limiting resistor"
  },
  "circuit": {
    "parts": [
      {
        "id": "B1",
        "type": "battery",
        "props": {
          "value": "9V"
        }
      },
      {
        "id": "R1",
        "type": "resistor",
        "props": {
          "value": "470"
        }
      },
      {
        "id": "D1",
        "type": "led",
        "props": {
          "color": "red"
        }
      }
    ],
    "nets": [
      {
        "id": "n1",
        "name": "PWR",
        "endpoints": [
          "B1[+]",
          "R1[1]"
        ]
      },
      {
        "id": "n2",
        "endpoints": [
          "D1[A]",
          "R1[2]"
        ]
      },
      {
        "id": "n3",
        "name": "GND",
        "endpoints": [
          "B1[-]",
          "D1[K]"
        ]
      }
    ]
  }
}
```

Three parts and three nets. Net `n1` connects the battery's positive terminal to one end of the
resistor. Net `n2` connects the other end of the resistor to the LED anode, pin `A`. Net `n3`
connects the LED cathode, pin `K`, to the battery's negative terminal. The last net is named
`GND`, so it is a ground net.

<!-- checked: examples/led.schem.json is the file quoted; its endpoints are numbers accepted by src/core/validate.ts resolveEndpoint(), and its names by src/core/model.ts netKind() -->
