# schemdraw baseline, case 3, attempt 1: three source+resistor rows on the left feeding a vertical summing
# bus, inverting amplifier with Rf above it, load on the right; local ground symbols.
from schemdraw_kit import elm, run


def draw(S, nl):
    rows = [("V1", "1V", "R1", 12), ("V2", "0.5V", "R2", 8), ("V3", "0.2V", "R3", 4)]
    BUS = 6.5
    for v, val, r, y in rows:
        vs = S.part(elm.SourceV().at((0, y - 3)).up().label(f"{v}\n{val}", loc="bot", ofst=0.3), v, {"-": "start", "+": "end"})
        rr = S.part(elm.Resistor().at((2, y)).right().label(f"{r}\n10k"), r, {"1": "start", "2": "end"})
        S.wire(vs.end, rr.start)
        S.power(vs.start, "GND", kind="gnd")
        S.wire(rr.end, (BUS, y))
    S.wire((BUS, 12), (BUS, 4))
    S.label((BUS, 4), "SUM", loc="bottom")
    u1 = S.part(elm.Opamp().anchor("in1").at((8.5, 8)).right().label("U1", loc="center"), "U1", {"2": "in1", "3": "in2", "1": "out"})
    S.wire((BUS, 8), u1.in1)
    S.wire(u1.in2, (u1.in2[0] - 0.5, u1.in2[1]), (u1.in2[0] - 0.5, u1.in2[1] - 0.8))
    S.power((u1.in2[0] - 0.5, u1.in2[1] - 0.8), "GND", kind="gnd")
    rf = S.part(elm.Resistor().at((8, 10.5)).right().label("Rf\n20k"), "Rf", {"1": "start", "2": "end"})
    S.wire((BUS, 10.5), rf.start)
    xo = rf.end[0] + 0.5
    S.wire(rf.end, (xo, 10.5), (xo, u1.out[1]))
    S.wire(u1.out, (xo + 1.5, u1.out[1]))
    S.label((xo + 1.5, u1.out[1]), "OUT", loc="right")
    rl = S.part(elm.Resistor().at((xo + 1.5, u1.out[1])).down().label("RL\n2k2", loc="bot"), "RL", {"1": "start", "2": "end"})
    S.power(rl.end, "GND", kind="gnd")


run(draw)
