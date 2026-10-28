# schemdraw baseline, case 1, attempt 1: a single loop, battery on the left, current clockwise.
from schemdraw_kit import elm, run


def draw(S, nl):
    b1 = S.part(elm.Battery().at((0, 3)).down().label("B1\n9V", loc="bot", ofst=0.3).label("+", loc="lft", ofst=-0.1),
                "B1", {"+": "start", "-": "end"})
    r1 = S.part(elm.Resistor().at((1.5, 4.5)).right().label("R1\n470"), "R1", {"1": "start", "2": "end"})
    d1 = S.part(elm.LED().at((6, 3)).down().label("D1\nred", loc="bot"), "D1", {"A": "start", "K": "end"})
    S.wire(b1.start, (0, 4.5), r1.start)
    S.label((0, 4.5), "PWR", loc="top")
    S.wire(r1.end, (6, 4.5), d1.start)
    S.wire(d1.end, (6, -1), (0, -1), b1.end)
    S.power((3, -1), "GND", kind="gnd")


run(draw)
