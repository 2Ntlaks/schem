# schemdraw baseline, case 8, attempt 1: differential pair Q1/Q2 with a PNP current-mirror load Q3/Q4,
# tail resistor to -12 V, input source on the left, output load on the right, split supply drawn as two
# sources with their midpoint at ground.
from schemdraw_kit import elm, run


def draw(S, nl):
    TOP, BOT = 12.5, -4.0
    # supplies: +12 V above ground, -12 V below ground, midpoint grounded
    v2 = S.part(elm.SourceV().at((-2, 6)).up().label("V2\n12 V", loc="left"), "V2", {"-": "start", "+": "end"})
    S.wire(v2.end, (-2, TOP))
    S.wire(v2.start, (-2, 5.5))
    S.power((-2, 5.5), "GND", kind="gnd")
    v3 = S.part(elm.SourceV().at((-2, BOT)).up().label("V3\n12 V", loc="left"), "V3", {"-": "start", "+": "end"})
    S.wire(v3.end, (-2, 0.0))
    S.power((-2, 0.0), "GND", kind="gnd")
    S.wire(v3.start, (-2, BOT), (8, BOT))
    S.label((1.0, TOP), "+12V", loc="top")
    S.label((1.0, BOT), "-12V", loc="bottom")
    S.wire((-2, TOP), (12.5, TOP))
    # input source between ground and Q1 base
    v1 = S.part(elm.SourceV().at((1.5, 5)).right().to((4, 5)).label("V1\n1 mV", loc="bot"), "V1",
                {"-": "start", "+": "end"})
    S.power(v1.start, "GND", kind="gnd")
    # pair
    q1 = S.part(elm.BjtNpn().at((4, 5)).right().label("Q1\n2N3904", loc="left"), "Q1",
                {"B": "base", "C": "collector", "E": "emitter"})
    q2 = S.part(elm.BjtNpn().at((9, 5)).right().label("Q2\n2N3904", loc="right"), "Q2",
                {"B": "base", "C": "collector", "E": "emitter"})
    S.wire(q2.base, (8.3, 5), (8.3, 4.0))
    S.power((8.3, 4.0), "GND", kind="gnd")
    S.wire(q1.emitter, (q1.emitter[0], 2.5))
    S.wire(q2.emitter, (q2.emitter[0], 2.5))
    S.wire((q1.emitter[0], 2.5), (q2.emitter[0], 2.5))
    re = S.part(elm.Resistor().at((7.2, 2.5)).down().label("RE\n11k", loc="right"), "RE",
                {"1": "start", "2": "end"})
    S.wire(re.end, (7.2, BOT))
    S.label((6.0, 2.5), "TAIL", loc="bot")
    # current-mirror load: Q3 diode-connected, base tied to Q4, emitters to +12 V
    q3 = S.part(elm.BjtPnp().reverse().at((6, 9)).right().label("Q3\n2N3906", loc="left"), "Q3",
                {"B": "base", "C": "collector", "E": "emitter"})
    q4 = S.part(elm.BjtPnp().at((10, 9)).right().label("Q4\n2N3906", loc="right"), "Q4",
                {"B": "base", "C": "collector", "E": "emitter"})
    S.wire(q3.base, q4.base)
    S.wire(q3.emitter, (q3.emitter[0], TOP))
    S.wire(q4.emitter, (q4.emitter[0], TOP))
    S.wire(q3.collector, (q3.collector[0], 7.8), (6, 7.8), q3.base)
    S.wire(q1.collector, (q1.collector[0], 7.8), (6, 7.8))
    S.wire(q4.collector, (q4.collector[0], q2.collector[1]), q2.collector)
    S.label((7.0, 7.8), "MIRROR", loc="top")
    # output load
    S.wire(q2.collector, (13, q2.collector[1]))
    rl = S.part(elm.Resistor().at((13, q2.collector[1])).down().label("RL\n10k", loc="right"), "RL",
                {"1": "start", "2": "end"})
    S.power(rl.end, "GND", kind="gnd")
    S.label((12.0, q2.collector[1]), "OUT", loc="top")


run(draw)
