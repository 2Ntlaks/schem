# schemdraw baseline, case 1, attempt 3: same loop as attempt 2, with the "+" beside the battery's positive
# plate. The plates sit at the inner end of the battery symbol (y 1.78 to 1.22 for a battery starting at 3.0),
# not at the start anchor, so earlier positions put the sign on the long top lead.
from schemdraw_kit import elm, run


def draw(S, nl):
    b1 = S.part(elm.Battery().at((0, 3)).down().label("B1\n9V", loc="bot", ofst=0.3),
                "B1", {"+": "start", "-": "end"})
    S.text((-0.55, 1.78), "+")
    r1 = S.part(elm.Resistor().at((1.5, 4.5)).right().label("R1\n470"), "R1", {"1": "start", "2": "end"})
    d1 = S.part(elm.LED().at((6, 3)).down().label("D1\nred", loc="bot"), "D1", {"A": "start", "K": "end"})
    S.wire(b1.start, (0, 4.5), r1.start)
    S.label((0, 4.5), "PWR", loc="top")
    S.wire(r1.end, (6, 4.5), d1.start)
    S.wire(d1.end, (6, -1), (0, -1), b1.end)
    S.power((3, -1), "GND", kind="gnd")


run(draw)
