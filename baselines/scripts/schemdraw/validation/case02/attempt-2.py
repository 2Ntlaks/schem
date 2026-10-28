# schemdraw baseline, case 2, attempt 2: same circuit as attempt 1. The battery "+" label is placed beside the
# positive plate, and the VOUT label is moved along the output wire so it no longer sits on the feedback corner.
from schemdraw_kit import elm, run


def draw(S, nl):
    GND_Y, TOP_Y = 1.0, 10.0
    b1 = S.part(elm.Battery().at((0, 7)).down().label("B1\n9V", loc="bot", ofst=0.3), "B1", {"+": "start", "-": "end"})
    S.text((-0.5, 7.0), "+")
    r1 = S.part(elm.Resistor().at((3, TOP_Y)).down().label("R1\n10k", loc="bot"), "R1", {"1": "start", "2": "end"})
    r2 = S.part(elm.Resistor().at((3, 7)).down().label("R2\n10k", loc="bot"), "R2", {"1": "start", "2": "end"})
    c1 = S.part(elm.Capacitor().at((5.5, 7)).down().label("C1\n100n", loc="bot"), "C1", {"1": "start", "2": "end"})
    u1 = S.part(elm.Opamp().anchor("in2").at((8.5, 7)).right().label("U1", loc="center", ofst=(0.0, 0.0)),
                "U1", {"2": "in1", "3": "in2", "1": "out"})
    xo = u1.out[0] + 1.0
    rl = S.part(elm.Resistor().at((xo + 1.0, u1.out[1])).down().label("RL\n10k", loc="bot"), "RL", {"1": "start", "2": "end"})
    # 9V
    S.wire(b1.start, (0, TOP_Y), r1.start)
    S.label((1.5, TOP_Y), "9V", loc="top")
    # VREF
    S.wire(r1.end, (5.5, 7), u1.in2)
    S.label((7.0, 7), "VREF", loc="top")
    # VOUT: output, feedback to IN-, load
    S.wire(u1.out, (xo + 1.0, u1.out[1]))
    S.wire(u1.in1, (u1.in1[0] - 0.6, u1.in1[1]), (u1.in1[0] - 0.6, u1.in1[1] + 1.4), (xo, u1.in1[1] + 1.4), (xo, u1.out[1]))
    S.label((xo + 0.35, u1.out[1]), "VOUT", loc="top")
    # GND rail
    S.wire(b1.end, (0, GND_Y), (xo + 1.0, GND_Y), rl.end)
    S.wire(r2.end, (3, GND_Y))
    S.wire(c1.end, (5.5, GND_Y))
    S.power((4.25, GND_Y), "GND", kind="gnd")


run(draw)
