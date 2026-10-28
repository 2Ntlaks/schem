# schemdraw baseline, case 6, attempt 1: ESP32 drives an NPN through a base resistor; the relay coil sits
# between 5 V and the collector with a flyback diode across it; the load connector is on the right.
from schemdraw_kit import elm, run


def draw(S, nl):
    TOP, GND = 13.0, 1.5
    u1 = S.ic("U1", (0, 5), {"top": [("J2-19", "5V")], "bot": [("J2-14", "GND")],
                             "right": [("J2-10", "IO26")]},
              "U1\nESP32-DevKitC V4", size=(4.5, 4))
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
    k1.label("K1\n5 V relay", loc="top")
    S.wire(k1.in1, (9.5, TOP))
    S.wire(k1.in2, (9.5, 5.2), q1.collector)
    d1 = S.part(elm.Diode().at((8.5, 8.5)).to((8.5, 10.5)).label("D1\n1N4148", loc="left"),
                "D1", {"A": "start", "K": "end"})
    S.wire(d1.start, (9.5, 8.5))
    S.wire(d1.end, (9.5, 10.5))
    # load connector, three contacts: 12 is the resting (NC) contact, 14 the open (NO) one
    j1 = S.part(elm.Header(rows=3, pinsleft=["COM", "NO", "NC"]).at((15, 4)).right().label("J1\nLOAD", loc="top"),
                "J1", {"1": "pin1", "2": "pin2", "3": "pin3"})
    S.wire(k1.a, (14, 10.5), (14, 5.5), j1.pin1)
    S.wire(k1.b, (11.24, 7.8), (13.5, 7.8), (13.5, 4.3), j1.pin3)
    S.wire(k1.c, (10.44, 7.4), (13, 7.4), (13, 4.9), j1.pin2)


run(draw)
