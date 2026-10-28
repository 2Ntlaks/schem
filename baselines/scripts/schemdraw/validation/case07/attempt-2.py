# schemdraw baseline, case 7, attempt 2: one 5 V rail across the top, the four decoupling capacitors hanging
# from it beside their ICs, U1's reset pull-up above its reset pin, and the I2C pull-ups between the two ICs.
# Attempt 1 put each capacitor on its own supply symbol; the four symbols and their labels crowded each other
# and the J1 supply wire, and the top pin labels of U1 ran together. This attempt uses a shared rail and a
# wider pin spacing so every label has room.
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


def cap_to_ground(S, ref, value, x, rail_y, side):
    """Vertical capacitor from the 5 V rail down to a ground symbol."""
    S.wire((x, rail_y), (x, rail_y - 0.5))
    c = S.part(elm.Capacitor().at((x, rail_y - 0.5)).down().length(2.5).label(f"{ref}\n{value}", loc=side),
               ref, {"1": "start", "2": "end"})
    S.wire(c.end, (x, c.end[1] - 1.0))
    S.power((x, c.end[1] - 1.0), "GND", kind="gnd")


def draw(S, nl):
    RAIL = 15.0
    # connector
    ic(S, "J1", (0, 8), {"right": [("1", "5V"), ("2", "GND")]}, "J1\n5V IN", size=(2.8, 3))
    # 5 V rail, fed from J1 pin 1
    S.wire(S.anchor("J1", "1"), (4.2, 9.5), (4.2, RAIL), (33.6, RAIL))
    S.label((4.8, RAIL), "5V", loc="top")
    # J1 ground
    S.wire(S.anchor("J1", "2"), (5.4, 8.5), (5.4, 5.0))
    S.power((5.4, 5.0), "GND", kind="gnd")

    # decoupling capacitors, two beside each IC
    cap_to_ground(S, "C1", "100n", 6.4, RAIL, "left")
    cap_to_ground(S, "C2", "100n", 8.0, RAIL, "right")
    cap_to_ground(S, "C3", "100n", 32.0, RAIL, "left")
    cap_to_ground(S, "C4", "10u", 33.6, RAIL, "right")

    # U1: reset pull-up, VCC and AVCC straight up to the rail, ground pins below, I2C on the right
    ic(S, "U1", (9, 6), {"top": [("1", "RESET"), ("7", "VCC"), ("20", "AVCC")],
                         "bot": [("8", "GND"), ("22", "GND")],
                         "right": [("27", "PC4"), ("28", "PC5")]},
       "U1\nATmega328P", size=(6, 6))
    reset = S.anchor("U1", "1")
    r1 = S.part(elm.Resistor().at((reset[0], RAIL)).down().length(2.0).label("R1\n10k", loc="left"), "R1",
                {"1": "start", "2": "end"})
    S.wire(r1.end, reset)
    for pin in ("7", "20"):
        p = S.anchor("U1", pin)
        S.wire(p, (p[0], RAIL))
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
    vcc = S.anchor("U2", "8")
    S.wire(vcc, (vcc[0], RAIL))
    gnd2 = [S.anchor("U2", pin) for pin in ("1", "2", "3", "4", "7")]
    for p in gnd2:
        S.wire(p, (p[0], 4.4))
    S.wire((gnd2[0][0], 4.4), (gnd2[-1][0], 4.4))
    S.power((vcc[0], 4.4), "GND", kind="gnd")

    # I2C buses and their pull-ups
    sda, scl = S.anchor("U1", "27"), S.anchor("U1", "28")
    S.wire(sda, S.anchor("U2", "5"))
    S.wire(scl, S.anchor("U2", "6"))
    for ref, x, y, value in (("R2", 18.5, sda[1], "4.7k"), ("R3", 20.3, scl[1], "4.7k")):
        r = S.part(elm.Resistor().at((x, RAIL)).down().length(2.0).label(f"{ref}\n{value}", loc="right"), ref,
                   {"1": "start", "2": "end"})
        S.wire(r.end, (x, y))
    S.label((16.6, sda[1]), "SDA", loc="top")
    S.label((16.6, scl[1]), "SCL", loc="bottom")


run(draw)
