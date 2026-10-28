# schemdraw baseline, case 8, attempt 4: attempt 3 with the MIRROR label centred under the mirror wire; in
# attempt 3 it started at x=6.0 and its last letters crossed Q1's collector wire. Source labels are free text
# beside each source (element labels on an upward source flip to the wire side); Q1/Q2 labels sit above the
# pair; OUT and TAIL sit beside their wires; Q2's base ground is a short stub. The diode connection from Q3's
# collector to its base goes right and up, not diagonally.
from schemdraw_kit import elm, run


def draw(S, nl):
    TOP, BOT = 14.0, -4.0
    # supplies: +12 V above ground, -12 V below ground, midpoint grounded
    v2 = S.part(elm.SourceV().at((-2, 5.5)).up().length(4.0), "V2", {"-": "start", "+": "end"})
    S.text((-2.6, 7.5), "V2\n12 V", halign="right", valign="center")
    S.wire(v2.end, (-2, TOP))
    S.power(v2.start, "GND", kind="gnd")
    v3 = S.part(elm.SourceV().at((-2, BOT)).up().length(4.0), "V3", {"-": "start", "+": "end"})
    S.text((-2.6, -2.0), "V3\n12 V", halign="right", valign="center")
    S.wire(v3.end, (-2, 0.0))
    S.power((-2, 0.0), "GND", kind="gnd")
    S.wire(v3.start, (8, BOT))
    S.label((0.0, TOP), "+12V", loc="top")
    S.label((0.0, BOT), "-12V", loc="bottom")
    # input source, vertical, ground at the bottom
    v1 = S.part(elm.SourceV().at((1.5, 2.5)).up().length(2.0), "V1", {"-": "start", "+": "end"})
    S.text((0.9, 3.5), "V1\n1 mV", halign="right", valign="center")
    S.power(v1.start, "GND", kind="gnd")
    S.wire(v1.end, (1.5, 5.0), (5.0, 5.0))
    # pair
    q1 = S.part(elm.BjtNpn().at((5, 5)).right(), "Q1", {"B": "base", "C": "collector", "E": "emitter"})
    q2 = S.part(elm.BjtNpn().at((10, 5)).right(), "Q2", {"B": "base", "C": "collector", "E": "emitter"})
    S.text((4.55, 6.2), "Q1\n2N3904", halign="center", valign="center")
    S.text((9.6, 6.2), "Q2\n2N3904", halign="center", valign="center")
    # Q2 base to ground, short stub
    S.wire(q2.base, (9.6, 5.0), (9.6, 4.7))
    S.power((9.6, 4.7), "GND", kind="gnd")
    S.wire(q1.emitter, (q1.emitter[0], 3.0))
    S.wire(q2.emitter, (q2.emitter[0], 3.0))
    S.wire((q1.emitter[0], 3.0), (q2.emitter[0], 3.0))
    re = S.part(elm.Resistor().at((8, 3.0)).down().label("RE\n11k", loc="right"), "RE", {"1": "start", "2": "end"})
    S.wire(re.end, (8, BOT))
    S.text((6.2, 2.85), "TAIL", halign="center", valign="top")
    # current-mirror load: Q3 diode-connected, base tied to Q4, emitters to +12 V
    q3 = S.part(elm.BjtPnp().reverse().at((7, 10)).right().label("Q3\n2N3906", loc="left"), "Q3",
                {"B": "base", "C": "collector", "E": "emitter"})
    q4 = S.part(elm.BjtPnp().at((11, 10)).right().label("Q4\n2N3906", loc="right"), "Q4",
                {"B": "base", "C": "collector", "E": "emitter"})
    S.wire(q3.base, q4.base)
    S.wire(q3.emitter, (q3.emitter[0], TOP))
    S.wire(q4.emitter, (q4.emitter[0], TOP))
    S.wire((-2, TOP), (q4.emitter[0], TOP))
    S.wire(q3.collector, (q3.collector[0], 8.8), (7, 8.8), (q3.base[0], 8.8), q3.base)
    S.wire(q1.collector, (q1.collector[0], 8.8), (7, 8.8))
    S.wire(q4.collector, (q4.collector[0], 6.5), (q2.collector[0], 6.5), q2.collector)
    S.text((7.75, 8.5), "MIRROR", halign="center", valign="top")
    # output load
    OUTY = q2.collector[1] + 0.8
    S.wire((q2.collector[0], OUTY), (13.5, OUTY))
    rl = S.part(elm.Resistor().at((13.5, OUTY)).down().label("RL\n10k", loc="right"), "RL",
                {"1": "start", "2": "end"})
    S.power(rl.end, "GND", kind="gnd")
    S.text((12.3, OUTY + 0.15), "OUT", halign="center", valign="bottom")


run(draw)
