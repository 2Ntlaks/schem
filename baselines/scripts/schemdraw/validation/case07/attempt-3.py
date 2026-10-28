# schemdraw baseline, case 7, attempt 3: the shared 5 V rail of attempt 2, with the labels moved into the empty
# spaces and the connector leads made orthogonal. The capacitors now carry their ref/value as free text under
# their ground symbols (element labels on a vertical capacitor flip sides, which is what put C2 and C4 on the
# rail in attempt 2); R1 and the I2C pull-ups carry free text beside their bodies. J1's two leads leave
# horizontally and then turn, instead of running diagonally.
from schemdraw_kit import elm, run


def ic(S, ref, at, sides, label, size=None, pinspacing=1.6, leadlen=0.6):
    pins, amap = [], {}
    for side in ("left", "right", "top", "bot"):
        seq = list(sides.get(side, []))
        if side in ("left", "right"):
            seq = seq[::-1]  # schemdraw stacks side pins bottom-up
        for cp, name in seq:
            an = f"{ref}_p_" + "".join(ch if ch.isalnum() else "_" for ch in cp)
            pins.append(elm.IcPin(name=name, side=side[0].upper() if side != "bot" else "B", anchorname=an))
            amap[cp] = an
    e = elm.Ic(pins=pins, size=size, pinspacing=pinspacing, leadlen=leadlen).at(at).right().label(label)
    return S.part(e, ref, amap)


def cap_to_ground(S, ref, value, x, rail_y, label_y):
    """Vertical capacitor from the 5 V rail down to a stub; the caller joins the stubs to one ground symbol."""
    S.wire((x, rail_y), (x, rail_y - 0.5))
    c = S.part(elm.Capacitor().at((x, rail_y - 0.5)).down().length(2.5), ref, {"1": "start", "2": "end"})
    S.wire(c.end, (x, rail_y - 4.0))
    S.text((x, label_y), f"{ref}\n{value}", halign="center", valign="top")


def draw(S, nl):
    RAIL = 15.0
    # connector
    ic(S, "J1", (0, 8), {"right": [("1", "5V"), ("2", "GND")]}, "J1\n5V IN", size=(2.8, 3))
    p1, p2 = S.anchor("J1", "1"), S.anchor("J1", "2")
    # 5 V rail from J1 pin 1, up and across
    S.wire(p1, (p1[0], RAIL), (34.6, RAIL))
    S.label((4.2, RAIL), "5V", loc="top")
    # J1 ground
    S.wire(p2, (p2[0] + 0.6, p2[1]), (p2[0] + 0.6, 5.0))
    S.power((p2[0] + 0.6, 5.0), "GND", kind="gnd")

    # decoupling capacitors: two beside each IC, each pair sharing a ground symbol
    for (x1, x2, ref1, v1, ref2, v2) in ((5.2, 6.8, "C1", "100n", "C2", "100n"),
                                        (32.0, 33.8, "C3", "100n", "C4", "10u")):
        cap_to_ground(S, ref1, v1, x1, RAIL, 9.9)
        cap_to_ground(S, ref2, v2, x2, RAIL, 9.9)
        S.wire((x1, RAIL - 4.0), (x2, RAIL - 4.0))
        S.power(((x1 + x2) / 2, RAIL - 4.0), "GND", kind="gnd")

    # U1: reset pull-up, VCC and AVCC straight up to the rail, ground pins below, I2C on the right
    ic(S, "U1", (9, 6), {"top": [("1", "RESET"), ("7", "VCC"), ("20", "AVCC")],
                         "bot": [("8", "GND"), ("22", "GND")],
                         "right": [("27", "PC4"), ("28", "PC5")]},
       "U1\nATmega328P", size=(6, 6))
    reset, vcc1, avcc = S.anchor("U1", "1"), S.anchor("U1", "7"), S.anchor("U1", "20")
    r1 = S.part(elm.Resistor().at((reset[0], RAIL)).down().length(2.0), "R1", {"1": "start", "2": "end"})
    S.text((reset[0] - 0.45, 14.0), "R1\n10k", halign="right", valign="center")
    S.wire(r1.end, reset)
    S.wire(vcc1, (vcc1[0], RAIL))
    S.wire(avcc, (avcc[0], RAIL))
    gnd1 = [S.anchor("U1", "8"), S.anchor("U1", "22")]
    for p in gnd1:
        S.wire(p, (p[0], 4.6))
    S.wire((gnd1[0][0], 4.6), (gnd1[1][0], 4.6))
    S.power(((gnd1[0][0] + gnd1[1][0]) / 2, 4.6), "GND", kind="gnd")

    # U2: SDA/SCL on the left, VCC on top, address and ground pins below
    ic(S, "U2", (23.5, 6), {"left": [("5", "SDA"), ("6", "SCL")],
                            "top": [("8", "VCC")],
                            "bot": [("1", "A0"), ("2", "A1"), ("3", "A2"), ("4", "VSS"), ("7", "WP")]},
       "U2\n24LC256", size=(7, 6))
    vcc2 = S.anchor("U2", "8")
    S.wire(vcc2, (vcc2[0], RAIL))
    gnd2 = [S.anchor("U2", pin) for pin in ("1", "2", "3", "4", "7")]
    for p in gnd2:
        S.wire(p, (p[0], 4.6))
    S.wire((gnd2[0][0], 4.6), (gnd2[-1][0], 4.6))
    S.power((vcc2[0], 4.6), "GND", kind="gnd")

    # I2C buses and their pull-ups
    sda, scl = S.anchor("U2", "5"), S.anchor("U2", "6")
    S.wire(S.anchor("U1", "27"), sda)
    S.wire(S.anchor("U1", "28"), scl)
    for ref, x, y in (("R2", 18.5, sda[1]), ("R3", 20.3, scl[1])):
        r = S.part(elm.Resistor().at((x, RAIL)).down().length(2.0), ref, {"1": "start", "2": "end"})
        S.wire(r.end, (x, y))
    S.text((18.05, 14.0), "R2\n4.7k", halign="right", valign="center")
    S.text((20.75, 14.0), "R3\n4.7k", halign="left", valign="center")
    S.label((16.6, sda[1]), "SDA", loc="top")
    S.label((16.6, scl[1]), "SCL", loc="bottom")


run(draw)
