# schemdraw baseline, case 7, attempt 1: two ICs with their decoupling capacitors beside their supply pins,
# local 5 V and ground symbols, and the I2C pull-ups above the bus. The two ICs share pin numbers, so the
# local ic() helper gives each pin anchor a reference prefix (the shared kit helper would mix them up).
from schemdraw_kit import elm, run


def ic(S, ref, at, sides, label, size=None, pinspacing=1.0, leadlen=0.6):
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


def decoupled_cap(S, ref, x, value, side):
    """Vertical capacitor between a 5 V symbol and a ground symbol, beside an IC."""
    S.power((x, 13.5), "5V")
    c = S.part(elm.Capacitor().at((x, 13.5)).down().label(f"{ref}\n{value}", loc=side), ref,
               {"1": "start", "2": "end"})
    S.wire(c.end, (x, 10.5), (x, 9.6))
    S.power((x, 9.6), "GND", kind="gnd")


def draw(S, nl):
    # connector
    ic(S, "J1", (0, 8), {"right": [("1", "5V"), ("2", "GND")]}, "J1\n5V IN", size=(2.6, 3))
    S.wire(S.anchor("J1", "1"), (4.3, 10.0), (4.3, 13.0))
    S.power((4.3, 13.0), "5V")
    S.wire(S.anchor("J1", "2"), (3.2, 8.2), (6.2, 8.2), (6.2, 5.0))
    S.power((6.2, 5.0), "GND", kind="gnd")

    # decoupling capacitors for U1 and U2
    decoupled_cap(S, "C1", 3.5, "100n", "left")
    decoupled_cap(S, "C2", 5.1, "100n", "right")
    decoupled_cap(S, "C3", 31.0, "100n", "left")
    decoupled_cap(S, "C4", 32.4, "10u", "right")

    # U1: reset pull-up, supply pins on top, ground pins below, I2C on the right
    ic(S, "U1", (8, 5), {"top": [("1", "RESET"), ("7", "VCC"), ("20", "AVCC")],
                         "bot": [("8", "GND"), ("22", "GND")],
                         "right": [("27", "PC4"), ("28", "PC5")]},
       "U1\nATmega328P", size=(7, 6))
    r1 = S.part(elm.Resistor().at((10.5, 13.5)).to((10.5, 11.6)).label("R1\n10k", loc="right"), "R1",
                {"1": "start", "2": "end"})
    S.power((10.5, 13.5), "5V")
    S.wire(S.anchor("U1", "7"), (11.5, 13.0))
    S.wire(S.anchor("U1", "20"), (12.5, 13.0))
    S.wire((11.5, 13.0), (12.5, 13.0))
    S.power((11.5, 13.0), "5V")
    for x in (11.0, 12.0):
        S.wire((x, 4.4), (x, 3.6))
    S.wire((11.0, 3.6), (12.0, 3.6))
    S.power((11.5, 3.6), "GND", kind="gnd")

    # U2: SDA/SCL on the left, VCC on top, address and ground pins below
    ic(S, "U2", (24, 5), {"left": [("5", "SDA"), ("6", "SCL")],
                          "top": [("8", "VCC")],
                          "bot": [("1", "A0"), ("2", "A1"), ("3", "A2"), ("4", "VSS"), ("7", "WP")]},
       "U2\n24LC256", size=(5, 6))
    S.wire(S.anchor("U2", "8"), (26.5, 12.5))
    S.power((26.5, 12.5), "5V")
    for x in (24.5, 25.5, 26.5, 27.5, 28.5):
        S.wire((x, 4.4), (x, 3.6))
    S.wire((24.5, 3.6), (28.5, 3.6))
    S.power((26.5, 3.6), "GND", kind="gnd")

    # I2C buses and their pull-ups
    S.wire(S.anchor("U1", "27"), S.anchor("U2", "5"))
    S.wire(S.anchor("U1", "28"), S.anchor("U2", "6"))
    for ref, x, y, value in (("R2", 18.5, 8.5, "4.7k"), ("R3", 19.7, 7.5, "4.7k")):
        r = S.part(elm.Resistor().at((x, 13.0)).to((x, 10.0)).label(f"{ref}\n{value}", loc="right"), ref,
                   {"1": "start", "2": "end"})
        S.power((x, 13.0), "5V")
        S.wire(r.end, (x, y))
    S.label((16.5, 8.5), "SDA", loc="top")
    S.label((16.5, 7.5), "SCL", loc="bottom")


run(draw)
