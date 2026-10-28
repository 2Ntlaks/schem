# schemdraw baseline, case 4, attempt 1: classic H shape. P-MOSFETs on top, N-MOSFETs below, motor across the
# middle; gate resistor + gate-source resistor networks on the outside; 12 V rail on top, ground rail below;
# the drive header J1 off to the right, joined by net labels HA/LA/HB/LB.
from schemdraw_kit import elm, run


def draw(S, nl):
    TOP, BOT = 12.5, 0.5
    q1 = S.part(elm.PFet().reverse().at((4, 10)).label("Q1\nIRF9540N", loc="bot", ofst=(0.6, 0)), "Q1", {"S": "source", "D": "drain", "G": "gate"})
    q2 = S.part(elm.NFet().reverse().at((4, 4.5)).label("Q2\nIRF540N", loc="bot", ofst=(0.6, 0)), "Q2", {"S": "source", "D": "drain", "G": "gate"})
    q3 = S.part(elm.PFet().at((12, 10)).label("Q3\nIRF9540N", loc="bot", ofst=(-0.6, 0)), "Q3", {"S": "source", "D": "drain", "G": "gate"})
    q4 = S.part(elm.NFet().at((12, 4.5)).label("Q4\nIRF540N", loc="bot", ofst=(-0.6, 0)), "Q4", {"S": "source", "D": "drain", "G": "gate"})
    m1 = S.part(elm.Motor().at((6.5, 6.5)).right().label("M1\n12 V DC motor"), "M1", {"1": "start", "2": "end"})
    S.wire(q1.drain, (4, 6.5), q2.drain)
    S.wire((4, 6.5), m1.start)
    S.wire(m1.end, (12, 6.5))
    S.wire(q3.drain, (12, 6.5), q4.drain)
    S.label((4, 6.5), "OUTA", loc="left")
    S.label((12, 6.5), "OUTB", loc="right")
    # left gate networks
    g1, g2 = (1.5, q1.gate[1]), (1.5, q2.gate[1])
    r1 = S.part(elm.Resistor().at((g1[0] - 3, g1[1])).right().label("R1\n100", loc="bot"), "R1", {"1": "start", "2": "end"})
    r5 = S.part(elm.Resistor().at((1.5, TOP)).to(g1).label("R5\n10k", loc="bot"), "R5", {"1": "start", "2": "end"})
    S.wire(g1, q1.gate)
    r2 = S.part(elm.Resistor().at((g2[0] - 3, g2[1])).right().label("R2\n100", loc="bot"), "R2", {"1": "start", "2": "end"})
    r6 = S.part(elm.Resistor().at(g2).to((1.5, BOT)).label("R6\n10k", loc="bot"), "R6", {"1": "start", "2": "end"})
    S.wire(g2, q2.gate)
    # right gate networks
    g3, g4 = (14.5, q3.gate[1]), (14.5, q4.gate[1])
    r3 = S.part(elm.Resistor().at((g3[0] + 3, g3[1])).left().label("R3\n100"), "R3", {"1": "start", "2": "end"})
    r7 = S.part(elm.Resistor().at((14.5, TOP)).to(g3).label("R7\n10k"), "R7", {"1": "start", "2": "end"})
    S.wire(g3, q3.gate)
    r4 = S.part(elm.Resistor().at((g4[0] + 3, g4[1])).left().label("R4\n100"), "R4", {"1": "start", "2": "end"})
    r8 = S.part(elm.Resistor().at(g4).to((14.5, BOT)).label("R8\n10k"), "R8", {"1": "start", "2": "end"})
    S.wire(g4, q4.gate)
    S.tag(r1.start, "HA", "left")
    S.tag(r2.start, "LA", "left")
    S.tag(r3.start, "HB", "right")
    S.tag(r4.start, "LB", "right")
    # battery and rails
    b1 = S.part(elm.Battery().at((-5, 8)).down().label("B1\n12V", loc="bot", ofst=0.3), "B1", {"+": "start", "-": "end"})
    S.text((-5.6, 7.6), "+")
    S.wire(b1.start, (-5, TOP), (14.5, TOP))
    S.wire(q1.source, (4, TOP))
    S.wire(q3.source, (12, TOP))
    S.label((-2, TOP), "12V", loc="top")
    S.wire(b1.end, (-5, BOT), (14.5, BOT))
    S.wire(q2.source, (4, BOT))
    S.wire(q4.source, (12, BOT))
    S.power((8, BOT), "GND", kind="gnd")
    # drive header
    j1 = S.part(elm.Header(rows=5, pinsleft=["HA", "LA", "HB", "LB", "GND"], pinspacing=1.0).at((21, 4.5)).label("J1 DRIVE", loc="top"),
                "J1", {"1": "pin1", "2": "pin2", "3": "pin3", "4": "pin4", "5": "pin5"})
    for pin, name in (("1", "HA"), ("2", "LA"), ("3", "HB"), ("4", "LB")):
        p = S.anchor("J1", pin)
        S.wire(p, (p[0] + 1.5, p[1]))
        S.tag((p[0] + 1.5, p[1]), name, "right")
    p5 = S.anchor("J1", "5")
    S.wire(p5, (p5[0] + 1.0, p5[1]), (p5[0] + 1.0, p5[1] - 0.6))
    S.power((p5[0] + 1.0, p5[1] - 0.6), "GND", kind="gnd")


run(draw)
