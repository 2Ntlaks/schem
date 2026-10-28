# schemdraw baseline, case 5, attempt 4: attempt 2's layout with the pull-up labels moved off the bus wires.
# Element labels on a vertical resistor flip to the wire side, and attempt 3's "loc=left" put R1's value on the
# IO21 wire and R2's on the SCL wire. Both are free text beside their resistor bodies now. The sensors' bus
# pins are on their left side so the taps cannot merge, and each sensor has its own VIN/ground symbols.
from schemdraw_kit import elm, run


def ic(S, ref, at, sides, label, size=None, pinspacing=1.0, leadlen=0.6):
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
    SDA_Y, SCL_Y = 8.5, 7.5
    ic(S, "U1", (0, 6), {"top": [("1", "3V3")], "bot": [("2", "GND")],
                         "right": [("3", "IO21"), ("4", "IO22")]},
       "U1\nESP32-DevKitC", size=(6, 4))
    S.wire(S.anchor("U1", "1"), (3, 11.5))
    S.power((3, 11.5), "3V3")
    S.wire(S.anchor("U1", "2"), (3, 4.5))
    S.power((3, 4.5), "GND", kind="gnd")

    # sensors below the bus, bus pins on the left
    for ref, x0, name in (("U2", 11, "BME280"), ("U3", 19, "SHT31")):
        ic(S, ref, (x0, 0), {"left": [("4", "SDA"), ("3", "SCL")], "top": [("1", "VIN")],
                             "bot": [("2", "GND")]}, f"{ref}\n{name}", size=(4, 3))
        vin = S.anchor(ref, "1")
        S.wire(vin, (vin[0], 4.5))
        S.power((vin[0], 4.5), "3V3")
        gnd = S.anchor(ref, "2")
        S.wire(gnd, (gnd[0], gnd[1] - 0.9))
        S.power((gnd[0], gnd[1] - 0.9), "GND", kind="gnd")

    # bus drops: SDA inside, SCL outside, so their horizontals never meet
    S.wire(S.anchor("U2", "4"), (9.2, 2.0), (9.2, SDA_Y))
    S.wire(S.anchor("U2", "3"), (8.2, 1.0), (8.2, SCL_Y))
    S.wire(S.anchor("U3", "4"), (17.2, 2.0), (17.2, SDA_Y))
    S.wire(S.anchor("U3", "3"), (16.2, 1.0), (16.2, SCL_Y))
    S.wire(S.anchor("U1", "3"), (17.2, SDA_Y))
    S.wire(S.anchor("U1", "4"), (26.0, SCL_Y))

    # pull-ups: R1 on SDA near the controller, R2 on SCL past the last sensor
    r1 = S.part(elm.Resistor().at((7.4, 12.0)).to((7.4, 9.0)), "R1", {"1": "start", "2": "end"})
    S.text((7.9, 10.5), "R1\n4.7k", halign="left", valign="center")
    S.power((7.4, 12.0), "3V3")
    S.wire(r1.end, (7.4, SDA_Y))
    r2 = S.part(elm.Resistor().at((26.0, 12.0)).to((26.0, 9.0)), "R2", {"1": "start", "2": "end"})
    S.text((26.5, 10.5), "R2\n4.7k", halign="left", valign="center")
    S.power((26.0, 12.0), "3V3")
    S.wire(r2.end, (26.0, SCL_Y))
    S.label((13.0, SDA_Y), "SDA", loc="top")
    S.label((13.0, SCL_Y), "SCL", loc="bottom")


run(draw)
