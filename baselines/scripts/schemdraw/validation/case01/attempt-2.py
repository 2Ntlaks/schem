# schemdraw baseline, case 1, attempt 2: same loop as attempt 1. The battery's "+" label is now beside the
# positive plate at the top of the battery; attempt 1's label offset put it below the battery.
from schemdraw_kit import elm, run


def draw(S, nl):
    b1 = S.part(elm.Battery().at((0, 3)).down().label("B1\n9V", loc="bot", ofst=0.3),
                "B1", {"+": "start", "-": "end"})
    S.text((-0.5, 3.0), "+")
    r1 = S.part(elm.Resistor().at((1.5, 4.5)).right().label("R1\n470"), "R1", {"1": "start", "2": "end"})
    d1 = S.part(elm.LED().at((6, 3)).down().label("D1\nred", loc="bot"), "D1", {"A": "start", "K": "end"})
    S.wire(b1.start, (0, 4.5), r1.start)
    S.label((0, 4.5), "PWR", loc="top")
    S.wire(r1.end, (6, 4.5), d1.start)
    S.wire(d1.end, (6, -1), (0, -1), b1.end)
    S.power((3, -1), "GND", kind="gnd")


run(draw)
