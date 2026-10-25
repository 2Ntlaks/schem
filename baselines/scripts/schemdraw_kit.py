"""Small helper for the hand-written schemdraw baselines.

Each case's drawing is plain schemdraw code (one file per attempt). This kit only adds bookkeeping so the
drawing can be checked against the case netlist *from its geometry*:

- `S.part(element, "R1", {"1": "start", "2": "end"})` adds an element and records where each case pin
  (case pin number -> schemdraw anchor) ended up;
- `S.wire(p1, p2, ...)` draws an orthogonal polyline from straight `Line` segments and records them;
- `S.power(pt, "GND")`, `S.label(pt, "SDA")` draw supply symbols and net labels and record them by name.

`check()` then rebuilds connectivity the way a reader would: a pin connects to a wire that touches it (end or
middle) or to a pin at the same point; a wire end connects to any wire it touches; two wires that only cross
do not connect; supply symbols and labels with the same text connect. The resulting groups of case pins are
compared with the case's nets. T-junctions get a dot automatically (`autodots`).

Run a drawing file:  python attempt-K.py <netlist.json> <out.svg>   (writes out.svg and out .check.txt)
"""
import json
import sys

import schemdraw
import schemdraw.elements as elm

schemdraw.use("svg")

EPS = 1e-6


def P(p):
    return (round(float(p[0]), 6), round(float(p[1]), 6))


def on_segment(p, a, b):
    """True when p lies on the axis-parallel or straight segment a-b (ends included)."""
    (x, y), (x1, y1), (x2, y2) = p, a, b
    cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)
    if abs(cross) > 1e-5:
        return False
    return min(x1, x2) - EPS <= x <= max(x1, x2) + EPS and min(y1, y2) - EPS <= y <= max(y1, y2) + EPS


class Sheet:
    def __init__(self, unit=3.0, fontsize=12, lw=1.6):
        self.d = schemdraw.Drawing(show=False)
        self.d.config(unit=unit, fontsize=fontsize, lw=lw)
        self.pins = {}      # "R1[1]" -> point
        self.segs = []      # (a, b)
        self.names = []     # (point, name)  supply symbols and net labels
        self.extra_dots = set()

    # ---------------------------------------------------------------- drawing helpers
    def part(self, e, ref, pins):
        self.d.add(e)
        for cp, an in pins.items():
            self.pins[f"{ref}[{cp}]"] = P(e.absanchors[an])
        return e

    def ic(self, ref, at, sides, label, size=None, pinspacing=1.0, leadlen=0.6, **kw):
        """Box part. sides = {"left"|"right": [(case pin, name), ...] top to bottom,
        "top"|"bot": [(case pin, name), ...] left to right}. `at` is the box's lower-left corner."""
        pins, amap = [], {}
        for side in ("left", "right", "top", "bot"):
            seq = list(sides.get(side, []))
            if side in ("left", "right"):
                seq = seq[::-1]  # schemdraw stacks side pins bottom-up
            for cp, name in seq:
                an = "p_" + "".join(ch if ch.isalnum() else "_" for ch in cp)
                pins.append(elm.IcPin(name=name, side=side[0].upper() if side != "bot" else "B", anchorname=an))
                amap[cp] = an
        e = elm.Ic(pins=pins, size=size, pinspacing=pinspacing, leadlen=leadlen, **kw).at(at).label(label)
        return self.part(e, ref, amap)

    def anchor(self, ref, pin):
        return self.pins[f"{ref}[{pin}]"]

    def wire(self, *pts):
        pts = [P(p) for p in pts]
        for a, b in zip(pts, pts[1:]):
            if a == b:
                continue
            self.d.add(elm.Line().at(a).to(b))
            self.segs.append((a, b))
        return pts[-1]

    def power(self, pt, name, kind="vdd", lead=0.0, **kw):
        """Supply symbol at pt. kind: vdd (arrow/bar up), gnd, vss (bar down)."""
        pt = P(pt)
        if lead:
            end = (pt[0], pt[1] + (lead if kind == "vdd" else -lead))
            self.wire(pt, end)
            pt = P(end)
        if kind == "gnd":
            e = elm.Ground().at(pt)
        elif kind == "vss":
            e = elm.Vss().at(pt).label(name, loc="bottom", **kw)
        else:
            e = elm.Vdd().at(pt).label(name, **kw)
        self.d.add(e)
        self.names.append((pt, name))
        return e

    def label(self, pt, name, loc="right", **kw):
        pt = P(pt)
        self.d.add(elm.Label().at(pt).label(name, loc=loc, **kw))
        self.names.append((pt, name))

    def tag(self, pt, name, direction="right", **kw):
        """A net label drawn as a short flag (schemdraw Tag) whose point is pt."""
        pt = P(pt)
        e = getattr(elm.Tag().at(pt), direction)().label(name, **kw)
        self.d.add(e)
        self.names.append((pt, name))
        return e

    def text(self, pt, s, **kw):
        """Free text (not a net label: it never joins anything)."""
        self.d.add(elm.Label().at(P(pt)).label(s, **kw))

    def dot(self, pt):
        self.extra_dots.add(P(pt))

    # ---------------------------------------------------------------- connectivity from geometry
    def groups(self):
        parent = {}

        def find(x):
            parent.setdefault(x, x)
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a, b):
            parent[find(a)] = find(b)

        nodes = [("pin", k) for k in self.pins] + [("seg", i) for i in range(len(self.segs))] + \
                [("name", i) for i in range(len(self.names))]
        for n in nodes:
            find(n)
        pin_items = list(self.pins.items())
        # pin <-> pin at the same point
        for i, (k1, p1) in enumerate(pin_items):
            for k2, p2 in pin_items[i + 1:]:
                if p1 == p2:
                    union(("pin", k1), ("pin", k2))
        # pin <-> wire touching it
        for k, p in pin_items:
            for i, (a, b) in enumerate(self.segs):
                if on_segment(p, a, b):
                    union(("pin", k), ("seg", i))
        # wire end <-> any wire
        for i, (a, b) in enumerate(self.segs):
            for j, (c, d) in enumerate(self.segs):
                if i != j and (on_segment(a, c, d) or on_segment(b, c, d)):
                    union(("seg", i), ("seg", j))
        # labels / supply symbols: attach to pins or wires at their point, and same text joins
        by_text = {}
        for i, (p, name) in enumerate(self.names):
            for k, q in pin_items:
                if p == q:
                    union(("name", i), ("pin", k))
            for j, (a, b) in enumerate(self.segs):
                if on_segment(p, a, b):
                    union(("name", i), ("seg", j))
            if name in by_text:
                union(("name", i), ("name", by_text[name]))
            else:
                by_text[name] = i
        out = {}
        for k in self.pins:
            out.setdefault(find(("pin", k)), []).append(k)
        dangling = [self.names[i][1] for i in range(len(self.names))
                    if not any(find(("pin", k)) == find(("name", i)) for k in self.pins)]
        return [sorted(v) for v in out.values()], dangling

    def autodots(self):
        """Dot every point where three or more wire/pin ends meet, or a wire end lands on a wire's middle."""
        ends = {}
        for a, b in self.segs:
            for p in (a, b):
                ends[p] = ends.get(p, 0) + 1
        pts = set()
        for p, n in ends.items():
            touching = n + sum(1 for q in self.pins.values() if q == p)
            mids = sum(1 for (a, b) in self.segs if on_segment(p, a, b) and p not in (a, b))
            if touching + 2 * mids >= 3:
                pts.add(p)
        for p in self.pins.values():  # a pin landing on the middle of a wire
            if sum(1 for (a, b) in self.segs if on_segment(p, a, b) and p not in (a, b)):
                pts.add(p)
        for p in pts | self.extra_dots:
            self.d.add(elm.Dot(radius=0.1).at(p))

    def check(self, nl):
        groups, dangling = self.groups()
        lines, ok = [], True
        nc = {f"{e['part']}[{e['pin']}]" for e in nl["nc"]}
        want_all = set()
        for n in nl["nets"]:
            want = sorted(f"{m['part']}[{m['pin']}]" for m in n["members"])
            want_all |= set(want)
            missing = [w for w in want if w not in self.pins]
            g = next((g for g in groups if want[0] in g), [])
            good = not missing and g == want
            ok &= good
            lines.append(f"{n['id']} {n['name'] or '(unnamed)'}: {'OK' if good else 'MISMATCH'} want={want} got={g}"
                         + (f" missing-pins={missing}" if missing else ""))
        for k in self.pins:
            if k not in want_all and k not in nc:
                ok = False
                lines.append(f"EXTRA pin drawn that is in no net: {k}")
        for k in nc:
            g = next((g for g in groups if k in g), [k])
            if len(g) > 1:
                ok = False
                lines.append(f"NC pin {k} is connected to {g}")
        if dangling:
            lines.append(f"note: labels/supply symbols not touching any pin: {dangling}")
        lines.append("RESULT " + ("PASS" if ok else "FAIL"))
        return ok, lines


def run(draw, unit=3.0, fontsize=12):
    netlist, out_svg = sys.argv[1], sys.argv[2]
    nl = json.load(open(netlist, encoding="utf-8"))
    S = Sheet(unit=unit, fontsize=fontsize)
    draw(S, nl)
    S.autodots()
    ok, lines = S.check(nl)
    S.d.save(out_svg)
    with open(out_svg[:-4] + ".check.txt", "w") as f:
        f.write("\n".join(lines) + "\n")
    print("check:", "PASS" if ok else "FAIL")
    for ln in lines:
        if "MISMATCH" in ln or "EXTRA" in ln or "NC pin" in ln:
            print(ln)
