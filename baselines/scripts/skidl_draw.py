"""SKiDL baseline: build one case's circuit with SKiDL and draw it with SKiDL's own schematic generator.

SKiDL 3.0.0's generate_svg() hands the circuit to the `schematizer` package, which places and routes it
exactly as generate_schematic() does for a .kicad_sch, and writes the result as SVG. KiCad itself is not
needed. Part symbols come from the KiCad 10 symbol library (KICAD10_SYMBOL_DIR); boxes for modules and
for ICs without a library symbol are generated as a small .kicad_sym library next to the output.

Usage (from the repo root, with the baselines venv):
    python baselines/scripts/skidl_draw.py <netlist.json> <attempt-K.config.json> <out-dir> <K>

Writes <out-dir>/attempt-K.svg, attempt-K.skidl-nets.json (the netlist SKiDL drew, mapped back to the
case's pin numbers) and attempt-K.check.txt (that netlist compared with the case).
The config file is the per-attempt "revision" lever; every key is optional (see README).
"""
import json
import os
import re
import shutil
import sys

KICAD_SYMBOLS = os.environ.setdefault("KICAD10_SYMBOL_DIR", r"C:\Users\ntlak\schem-baselines\kicad-symbols")

from skidl import *  # noqa: E402,F403  (NC, POWER, Net, Part, generate_svg, reset)

G = 2.54  # KiCad grid, mm

# Generic mapping from the case's symbol types to KiCad 10 library symbols. Pin maps go from the case pin
# number to the KiCad pin number. A part with a partNumber is first looked up in the part-number libraries.
TYPE_MAP = {
    "resistor": ("Device", "R", {"1": "1", "2": "2"}),
    "capacitor": ("Device", "C", {"1": "1", "2": "2"}),
    "polarised-capacitor": ("Device", "C_Polarized", {"+": "1", "-": "2"}),
    "led": ("Device", "LED", {"A": "2", "K": "1"}),
    "diode": ("Device", "D", {"A": "2", "K": "1"}),
    "battery": ("Device", "Battery", {"+": "1", "-": "2"}),
    "vsource": ("Simulation_SPICE", "VDC", {"+": "1", "-": "2"}),
    "ac-source": ("Simulation_SPICE", "VSIN", {"1": "1", "2": "2"}),
    "npn": ("Device", "Q_NPN", {"B": "B", "C": "C", "E": "E"}),
    "pnp": ("Device", "Q_PNP", {"B": "B", "C": "C", "E": "E"}),
    "nmos": ("Device", "Q_NMOS", {"G": "G", "D": "D", "S": "S"}),
    "pmos": ("Device", "Q_PMOS", {"G": "G", "D": "D", "S": "S"}),
    "motor": ("Motor", "Motor_DC", {"1": "1", "2": "2"}),
    # SANYOU/Songle SRD form C: coil 2 and 5, COM 1, NC 4 (resting contact), NO 3 (checked in the symbol graphics).
    "relay": ("Relay", "SANYOU_SRD_Form_C", {"A1": "5", "A2": "2", "11": "1", "12": "4", "14": "3"}),
    "spst": ("Switch", "SW_SPST", {"1": "1", "2": "2"}),
    "pushbutton": ("Switch", "SW_Push", {"1": "1", "2": "2"}),
    "buzzer": ("Device", "Buzzer", {"+": "1", "-": "2"}),
    "potentiometer": ("Device", "R_Potentiometer", {"1": "1", "2": "2", "3": "3"}),
    "fuse": ("Device", "Fuse", {"1": "1", "2": "2"}),
}
# KiCad libraries that hold symbols named by part number (2N3904, IRF540N, 1N4148 ...). Pins map by name.
PART_NUMBER_LIBS = {
    "npn": ["Transistor_BJT"], "pnp": ["Transistor_BJT"],
    "nmos": ["Transistor_FET"], "pmos": ["Transistor_FET"], "diode": ["Diode"],
}
PIN_NAME_OF = {"npn": {"B": "B", "C": "C", "E": "E"}, "pnp": {"B": "B", "C": "C", "E": "E"},
               "nmos": {"G": "G", "D": "D", "S": "S"}, "pmos": {"G": "G", "D": "D", "S": "S"},
               "diode": {"A": "A", "K": "K"}}

ROLE_TO_KICAD = {"power_in": "power_in", "power_out": "power_out", "ground": "power_in", "input": "input",
                 "output": "output", "bidir": "bidirectional", "passive": "passive", "nc": "no_connect"}


def sym_name(s):
    return re.sub(r"[^A-Za-z0-9_]", "_", s)


def eff(size=1.27, hide=False):
    return f'(effects (font (size {size} {size})){" (hide yes)" if hide else ""})'


def box_symbol(name, ref_prefix, value, sides, pinfo):
    """A KiCad symbol: a rectangle with pins on four sides. sides = {left|right|top|bottom: [pin numbers]}."""
    left, right = sides.get("left", []), sides.get("right", [])
    top, bottom = sides.get("top", []), sides.get("bottom", [])
    nm = lambda n: pinfo[n]["name"]
    char = 0.85  # mm per character at 1.27 mm text, a little generous
    side_text = max([len(nm(n)) for n in left] or [0]) + max([len(nm(n)) for n in right] or [0])
    tb_text = max([len(nm(n)) for n in top + bottom] or [0])
    w = max(side_text * char + 4 * G, (max(len(top), len(bottom)) + 1) * 2 * G, 6 * G)
    w = G * 2 * round(w / (2 * G) + 0.49)
    h = max(len(left), len(right)) * G + 2 * G + (tb_text * char * 2 if (top or bottom) else 0)
    h = max(G * 2 * round(h / (2 * G) + 0.49), 4 * G)
    x0, x1, y0, y1 = -w / 2, w / 2, h / 2, -h / 2
    L = G
    pins = []

    def pin(n, x, y, ang):
        t = ROLE_TO_KICAD[pinfo[n]["role"]]
        pins.append(f'(pin {t} line (at {x:.2f} {y:.2f} {ang}) (length {L}) (name "{nm(n)}" {eff()}) (number "{n}" {eff()}))')

    def ys(k):  # y positions for k side pins, centred, one grid apart
        start = (k - 1) * G / 2
        return [G * round((start - i * G) / G * 2) / 2 for i in range(k)]

    def xs(k):
        sp = 2 * G
        start = -(k - 1) * sp / 2
        return [start + i * sp for i in range(k)]

    for n, y in zip(left, ys(len(left))):
        pin(n, x0 - L, y, 0)
    for n, y in zip(right, ys(len(right))):
        pin(n, x1 + L, y, 180)
    for n, x in zip(top, xs(len(top))):
        pin(n, x, y0 + L, 270)
    for n, x in zip(bottom, xs(len(bottom))):
        pin(n, x, y1 - L, 90)
    return f'''  (symbol "{name}" (pin_names (offset 0.762)) (exclude_from_sim no) (in_bom yes) (on_board yes)
    (property "Reference" "{ref_prefix}" (at 0 {y0 + 1.5 * G:.2f} 0) {eff()})
    (property "Value" "{value}" (at 0 {y1 - 1.5 * G:.2f} 0) {eff()})
    (property "Footprint" "" (at 0 0 0) {eff(hide=True)})
    (property "Datasheet" "" (at 0 0 0) {eff(hide=True)})
    (symbol "{name}_1_1"
      (rectangle (start {x0:.2f} {y0:.2f}) (end {x1:.2f} {y1:.2f}) (stroke (width 0.254) (type default)) (fill (type background)))
      {chr(10).join("      " + p for p in pins)}
    )
  )'''


def opamp_symbol(name):
    """Three-pin op-amp triangle (the case's op-amp has no supply pins), KiCad style."""
    return f'''  (symbol "{name}" (pin_names (offset 0.254)) (exclude_from_sim no) (in_bom yes) (on_board yes)
    (property "Reference" "U" (at 2.54 5.08 0) {eff()})
    (property "Value" "{name}" (at 2.54 -5.08 0) {eff()})
    (property "Footprint" "" (at 0 0 0) {eff(hide=True)})
    (property "Datasheet" "" (at 0 0 0) {eff(hide=True)})
    (symbol "{name}_1_1"
      (polyline (pts (xy -5.08 5.08) (xy 5.08 0) (xy -5.08 -5.08) (xy -5.08 5.08)) (stroke (width 0.254) (type default)) (fill (type background)))
      (pin input line (at -7.62 2.54 0) (length 2.54) (name "-" {eff()}) (number "2" {eff()}))
      (pin input line (at -7.62 -2.54 0) (length 2.54) (name "+" {eff()}) (number "3" {eff()}))
      (pin output line (at 7.62 0 180) (length 2.54) (name "~" {eff()}) (number "1" {eff()}))
    )
  )'''


def default_sides(pins):
    sides = {"left": [], "right": [], "top": [], "bottom": []}
    for p in pins:
        r = p["role"]
        if r in ("power_in", "power_out"):
            sides["top"].append(p["number"])
        elif r == "ground":
            sides["bottom"].append(p["number"])
        elif r == "input":
            sides["left"].append(p["number"])
        else:
            sides["right"].append(p["number"])
    return sides


def try_part(lib, name, **kw):
    try:
        return Part(lib, name, **kw)
    except Exception:
        return None


def main():
    netlist_path, config_path, out_dir, k = sys.argv[1:5]
    nl = json.load(open(netlist_path))
    cfg = json.load(open(config_path)) if os.path.exists(config_path) else {}
    os.makedirs(out_dir, exist_ok=True)
    reset()

    used = {}  # part -> set of pin numbers in a net or nc
    for n in nl["nets"]:
        for m in n["members"]:
            used.setdefault(m["part"], set()).add(m["pin"])
    for e in nl["nc"]:
        used.setdefault(e["part"], set()).add(e["pin"])

    overrides = cfg.get("parts", {})
    custom_syms, custom_specs = [], {}
    pinmap = {}  # part -> {case pin: kicad pin}
    libspec = {}
    for p in nl["parts"]:
        pid, t, ov = p["id"], p["type"], overrides.get(p["id"], {})
        if "lib" in ov:  # explicit KiCad library symbol for this part
            libspec[pid] = (ov["lib"], ov["name"])
            pinmap[pid] = ov.get("pinmap") or {q["number"]: q["number"] for q in p["pins"]}
        elif t == "opamp":
            custom_specs[pid] = "OPAMP_3PIN"
            pinmap[pid] = {"2": "2", "3": "3", "1": "1"}
        elif t == "header":
            libspec[pid] = ("Connector_Generic", f"Conn_01x{len(p['pins']):02d}")
            pinmap[pid] = {q["number"]: q["number"] for q in p["pins"]}
        elif t in TYPE_MAP and not ov.get("box"):
            lib, name, pm = TYPE_MAP[t]
            pn = p["props"].get("partNumber")
            if pn and t in PART_NUMBER_LIBS and not ov.get("generic"):
                for plib in PART_NUMBER_LIBS[t]:
                    test = try_part(plib, pn, dest=TEMPLATE)
                    if test is not None:
                        byname = {q.name: q.num for q in test.pins}
                        pm = {c: byname[n] for c, n in PIN_NAME_OF[t].items()}
                        lib, name = plib, pn
                        break
            libspec[pid] = (lib, name)
            pinmap[pid] = pm
        else:  # ic, module, or forced box: generated rectangle with the used pins (SPEC 7.3 hides unused pins)
            show = ov.get("pins") or [q["number"] for q in p["pins"] if q["number"] in used.get(pid, set())]
            pinfo = {q["number"]: q for q in p["pins"]}
            sides = ov.get("sides") or default_sides([pinfo[n] for n in show])
            sname = sym_name(f"{pid}_{p['moduleName'] or p['props'].get('label') or t}")
            value = p["moduleName"] or p["props"].get("label") or p["label"] or t
            custom_syms.append(box_symbol(sname, re.match(r"[A-Za-z]+", pid).group(0), value, sides, pinfo))
            custom_specs[pid] = sname
            pinmap[pid] = {n: n for n in show}

    lib_path = None
    if custom_specs:
        body = [opamp_symbol("OPAMP_3PIN")] if "OPAMP_3PIN" in custom_specs.values() else []
        body += custom_syms
        lib_path = os.path.join(out_dir, f"attempt-{k}.custom.kicad_sym")
        with open(lib_path, "w", encoding="utf-8") as f:
            f.write('(kicad_symbol_lib (version 20241209) (generator "schem_baselines")\n' + "\n".join(body) + "\n)\n")

    parts = {}
    for p in nl["parts"]:
        pid = p["id"]
        value = overrides.get(pid, {}).get("value") or p["label"] or (p["moduleName"] or "")
        if pid in custom_specs:
            parts[pid] = Part(lib_path, custom_specs[pid], ref=pid, value=value)
        else:
            lib, name = libspec[pid]
            parts[pid] = Part(lib, name, ref=pid, value=value)

    power_names = set(cfg.get("power_nets", [n["name"] for n in nl["nets"] if n["kind"] in ("power", "ground") and n["name"]]))
    nets = {}
    for n in nl["nets"]:
        net = Net(n["name"]) if n["name"] else Net()
        if n["name"] in power_names:
            net.drive = POWER
        for m in n["members"]:
            net += parts[m["part"]][pinmap[m["part"]][m["pin"]]]
        nets[n["id"]] = net
    for e in nl["nc"]:
        parts[e["part"]][pinmap[e["part"]][e["pin"]]] += NC

    # ----- connection check: the netlist SKiDL holds, mapped back to case pins, against the case
    back = {pid: {v: c for c, v in pm.items()} for pid, pm in pinmap.items()}
    drawn = []
    for n in nl["nets"]:
        net = nets[n["id"]]
        members = sorted(f"{pin.part.ref}[{back[pin.part.ref].get(pin.num, '?' + pin.num)}]" for pin in net.pins)
        drawn.append({"id": n["id"], "name": n["name"], "skidl_name": net.name, "members": members})
    report, ok = [], True
    for n, d in zip(nl["nets"], drawn):
        want = sorted(f"{m['part']}[{m['pin']}]" for m in n["members"])
        good = want == d["members"]
        ok &= good
        report.append(f"{n['id']} {n['name'] or '(unnamed)'}: {'OK' if good else 'MISMATCH'} want={want} got={d['members']}")
    # pins connected to anything outside the case nets
    in_case = {(m["part"], m["pin"]) for n in nl["nets"] for m in n["members"]}
    for pid, part in parts.items():
        for pin in part.pins:
            c = back[pid].get(pin.num)
            if pin.net is not None and pin.net.name and not pin.net.name.startswith("NC") and pin.is_connected() and (pid, c) not in in_case and (pid, c) not in {(e["part"], e["pin"]) for e in nl["nc"]}:
                ok = False
                report.append(f"EXTRA connection {pid} pin {pin.num} on net {pin.net.name}")
    report.append("RESULT " + ("PASS" if ok else "FAIL"))
    with open(os.path.join(out_dir, f"attempt-{k}.check.txt"), "w") as f:
        f.write("\n".join(report) + "\n")
    with open(os.path.join(out_dir, f"attempt-{k}.skidl-nets.json"), "w") as f:
        json.dump(drawn, f, indent=1)

    opts = {"seed": 1, "flatness": 1.0, "auto_stub": False}  # wired drawing; see README (learned on a neutral circuit)
    opts.update(cfg.get("options", {}))
    tmp = os.path.join(out_dir, f"_svg-{k}")
    title = cfg.get("title", f"Case {nl['case']}")  # short title: the default names SKiDL in the title block
    used_opts = dict(opts)
    try:
        generate_svg(filepath=tmp, top_name=f"case{nl['case']:02d}", title=title, **opts)
    except Exception as e:  # noqa: BLE001
        # Same attempt, automatic fallback: the wired router gave up, so let SKiDL turn the nets it cannot
        # route into labels (generate_svg's own default, auto_stub=True), unless the config forbids it.
        if not cfg.get("fallback", True) or opts.get("auto_stub"):
            raise
        print(f"wired routing failed ({type(e).__name__}); falling back to auto_stub=True")
        shutil.rmtree(tmp, ignore_errors=True)
        used_opts = dict(opts, auto_stub=True, **cfg.get("fallback_options", {}))
        generate_svg(filepath=tmp, top_name=f"case{nl['case']:02d}", title=title, **used_opts)
    with open(os.path.join(out_dir, f"attempt-{k}.options.json"), "w") as f:
        json.dump(used_opts, f)
    svgs = [x for x in os.listdir(tmp) if x.endswith(".svg")]
    top = f"case{nl['case']:02d}.svg"
    shutil.copy(os.path.join(tmp, top), os.path.join(out_dir, f"attempt-{k}.svg"))
    extra = [x for x in svgs if x != top]
    if extra:
        print("NOTE: extra SVG pages:", extra)
    shutil.rmtree(tmp)
    print("check:", "PASS" if ok else "FAIL")


if __name__ == "__main__":
    main()
