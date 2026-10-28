# schemdraw baseline, case 6, attempt 3: attempt 2 with the U1 value shortened to "ESP32". Even "ESP32-DevKitC"
# ran into the IO26 pin name inside the 4.5 unit wide box. The rest is unchanged: visible K1 label, a roomy
# three-pin load connector, and separate NC/NO routes that never share a wire.
from schemdraw_kit import elm, run


def ic(S, ref, at, sides, label, size=None, pinspacing=1.2, leadlen=0.6):
    pins, amap = [], {}
    for side in ("left", "right", "top", "bot"):
        seq = list(sides.get(side, []))
        if side in ("left", "right"):
            seq = seq[::-1]
        for cp, name in seq:
            an = f"{ref}_p_" + "".join(ch if ch.isalnum() else "_" for ch in cp)
            pins.append(elm.IcPin(name=name, side=side[0].upper() if side != "bot" else "B", anchorname=an))
            amap[cp] = an
    e = elm.Ic(pins=pins, size=size, pinspacing=pinspacing, leadlen=leadlen).at(at).right().label(label)
    return S.part(e, ref, amap)


def draw(S, nl):
    TOP, GND = 13.0, 1.5
    u1 = S.ic("U1", (0, 5), {"top": [("J2-19", "5V")], "bot": [("J2-14", "GND")],
                             "right": [("J2-10", "IO26")]},
              "U1\nESP32", size=(4.5, 4))
    # 5 V rail and ground rail
    S.wire((0, TOP), (16, TOP))
    S.label((1.0, TOP), "5V", loc="top")
    S.wire((2.25, 9.6), (2.25, TOP))
    S.wire((2, GND), (16, GND))
    S.power((5.0, GND), "GND", kind="gnd")
    S.wire((2.25, 4.4), (2.25, GND))
    # base network: IO26 -> R1 -> Q1 base, R2 to ground
    r1 = S.part(elm.Resistor().at((5.6, 7)).right().label("R1\n1k", loc="top"), "R1", {"1": "start", "2": "end"})
    S.wire(S.anchor("U1", "J2-10"), r1.start)
    S.wire(r1.end, (7.5, 7), (7.5, 4.5), (9.5, 4.5))
    r2 = S.part(elm.Resistor().at((7.5, 4.5)).down().label("R2\n10k"), "R2", {"1": "start", "2": "end"})
    S.wire(r2.end, (7.5, GND))
    q1 = S.part(elm.BjtNpn().at((9.5, 4.5)).right().label("Q1\n2N2222A", loc="right"), "Q1",
                {"B": "base", "C": "collector", "E": "emitter"})
    S.wire(q1.emitter, (q1.emitter[0], GND))
    # relay coil and contacts (coil vertical, contacts below), flyback diode on the left
    k1 = S.part(elm.Relay(switch="spdt", unit=2, box=False).at((9.5, 10.5)).right(),
                "K1", {"A1": "in1", "A2": "in2", "11": "a", "12": "b", "14": "c"})
    S.text((7.6, 11.4), "K1\n5 V relay")
    S.wire(k1.in1, (9.5, TOP))
    S.wire(k1.in2, (9.5, 5.2), q1.collector)
    d1 = S.part(elm.Diode().at((8.5, 8.5)).to((8.5, 10.5)).label("D1\n1N4148", loc="left"),
                "D1", {"A": "start", "K": "end"})
    S.wire(d1.start, (9.5, 8.5))
    S.wire(d1.end, (9.5, 10.5))
    # load connector, three contacts: 12 is the resting (NC) contact, 14 the open (NO) one
    j1 = ic(S, "J1", (15.5, 2.5), {"left": [("1", "COM"), ("2", "NO"), ("3", "NC")]},
            "J1\nLOAD", size=(3, 4))
    S.wire(k1.a, (14.2, 10.5), (14.2, S.anchor("J1", "1")[1]), S.anchor("J1", "1"))
    S.wire(k1.b, (k1.b[0], 7.8), (13.0, 7.8), (13.0, S.anchor("J1", "3")[1]), S.anchor("J1", "3"))
    S.wire(k1.c, (k1.c[0], 7.4), (13.5, 7.4), (13.5, S.anchor("J1", "2")[1]), S.anchor("J1", "2"))


run(draw)
