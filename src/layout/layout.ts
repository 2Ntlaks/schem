// Layout pipeline (SPEC 9.2): generic placement, routing and decoupling child slots.

import {
  cmpNatural, cmpStr, edgeKey, gridBox, isHorizontal, key, step, unionBox, unitEdges, xformBox, xformDir, xformPt,
  boxesOverlap, type Box, type Dir, type Orient, type Pt,
} from "../geom/geom.js";
import { obstacleFromLabel, type Obstacle } from "../geom/forbidden.js";
import { canonical, netKind, railLevel, type Circuit, type Net, type PinDef, type PinDefs } from "../core/model.js";
import { groupRepresentative, validate, type ValidCircuit } from "../core/validate.js";
import { parseQuantity, quantityOf } from "../core/quantity.js";
import { BUILTIN, checkSymbol, HEADER, icSymbol, keepOut, type SymbolDef } from "../symbols/library.js";
import { defaultOrient, headerFor, headerPins, lowerRailEnd } from "./kinds.js";
import { decouplingMatches } from "./decoupling.js";
import { drawnAsPorts } from "./ports.js";
import { inferFlow, type FlowGraph } from "./flow.js";
import { findStacks, type Stack } from "./stacks.js";
import { measure } from "../text/font.js";
import { eq, solveWithDrops, X0, type Constraint } from "./solver.js";
import { route, type NetRequest } from "./router.js";
import { checkDrawing } from "../quality/index.js";
import {
  apartPairs, isBoundary, linkConstraints, matchTemplates, solveInterior, templateLabel, templateOrient, templateRanks, templateSides, trunkRows, trunkRuns, TEMPLATES,
  type Geo, type Interior, type Region,
} from "./templates/index.js";
import { edgeForbidden } from "../geom/forbidden.js";
import type { Art, DrawnPin, DrawnPort, Electrical, RenderModel } from "../render/model.js";
import { hintParts, type Intent, type LayoutState, type Side } from "../core/intent.js";

export interface Project { meta?: { title?: string }; circuit: Circuit; intent?: Intent }

export type Status = "valid" | "valid_low_confidence" | "infeasible" | "budget_exhausted" | "invalid_input";

/**
 * Fixed placement for every part (test hook, and the shape of a 0b template's output):
 * the part's origin, optional orientation, and optional pin sides for generated IC boxes.
 * Positions become lock constraints, so the normal solve, routing and rendering still run.
 */
export type { Side };
export type Placement = Record<string, { at: Pt; orient?: Orient; sides?: Partial<Record<Side, string[]>> }>;

export interface LayoutResult {
  status: Status;
  render?: RenderModel;
  pinDefs: PinDefs;
  issues: string[];
  notes: string[];
  /** Positions, orientations, pin sides and routes, for the next incremental layout. */
  state?: LayoutState;
  /** The block graph handed to ordering (SPEC 9.2 steps 1-2): template regions and single parts, with ranks. */
  blocks?: Array<{ id: string; parts: string[]; rank: number; template?: string; links?: string[] }>;
}

export interface LayoutOptions {
  spacing?: number;
  place?: Placement;
  prewire?: Prewire;
  /** Incremental mode (SPEC 9.5): the previous layout, and the parts the edit affects. */
  previous?: LayoutState;
  affected?: readonly string[];
  /** Keep the previous routes of nets whose drawn terminals did not change (default true). */
  reuseRoutes?: boolean;
  /**
   * Incremental mode: start new parts below the existing drawing instead of among the existing
   * parts. An edit's fallback when placing them among the others moves untouched parts.
   */
  newPartsBelow?: boolean;
  /**
   * Pattern templates (SPEC 9.4): on by default (off when `place` is given). `false` turns them off;
   * `skip` leaves out matches by region key (the step 5 fallback when a region cannot be solved).
   */
  templates?: false | { skip: readonly string[] };
  /** Bounded repair fallback when a child slot conflicts with stronger intent or geometry. */
  decoupling?: boolean;
  /** Vertical stacks found from the netlist (src/layout/stacks.ts): on by default, `false` is the fallback. */
  stacks?: boolean;
  /** Stagger vertical branches driven by chip pins: on by default, `false` is the fallback. */
  staggerBranches?: boolean;
  /** Pin order for generated IC boxes, from a first layout (set by the layout itself, see "Pin order"). */
  pinOrder?: Record<string, Partial<Record<Side, string[]>>>;
  /** Vertical flip for non-template op-amps, from a first layout so IN+ / IN- match connected heights. */
  opampOrient?: Record<string, Orient>;
}

const LABEL_SIZE = 12;   // SVG units (1.2 G)
const PIN_SIZE = 10;
const LINE = 1.5;        // G per label line
const MARGIN = 3;        // G, SPEC 12.1

// ---------------------------------------------------------------------------

export function pinDefsOf(circuit: Circuit): PinDefs {
  const defs: PinDefs = {};
  for (const p of circuit.parts) {
    const sym = BUILTIN[p.type];
    if (sym) defs[p.id] = sym.pins.map(({ at: _a, dir: _d, ...rest }) => rest);
    else if (p.type === "ic" || p.type.startsWith("module:")) defs[p.id] = (p.pins ?? []).map(defaultRole);
    else if (p.type === HEADER) defs[p.id] = headerPins(p.pins ?? []);
  }
  return defs;
}

function defaultRole(p: PinDef): PinDef {
  if (p.role) return p;
  const role = /^(GND|VSS|AGND|DGND)$/i.test(p.name) ? "ground" : /^(VCC|VDD|VIN|3V3|5V|V\+|VBAT)$/i.test(p.name) ? "power_in" : "bidir";
  return { ...p, role };
}

interface Placed {
  id: string;
  sym: SymbolDef;
  orient: Orient;
  col: number;
  rank: number;
  /** Local (oriented) geometry relative to the part origin. */
  ko: Box;
  labels: Array<{ box: Box; lines: string[]; align: "start" | "middle" | "end" }>;
  ports: Array<{ pin: string; net: Net; anchor: Pt; stub: Pt[]; box: Box; kind: "ground" | "power" }>;
  env: Box;
  pins: Array<{ number: string; at: Pt; dir: Dir }>;
}

/** Fixed conductor runs of a net (by net id), handed to the router as part of its tree (SPEC 9.2 step 7). */
export type Prewire = Record<string, Pt[][]>;

export function layout(project: Project, opts: LayoutOptions = {}): LayoutResult {
  const notes: string[] = [];
  const intent = project.intent ?? {};
  const locks = new Map((intent.locks ?? []).map((l) => [l.part, l]));
  const hints = intent.hints ?? [];
  const orientHint = new Map(hints.flatMap((h) => (h.type === "orient" ? [[h.part, h] as const] : [])));
  const sidesHint = new Map(hints.flatMap((h) => (h.type === "pinSides" ? [[h.part, h.sides] as const] : [])));
  const affected = new Set(opts.affected ?? []);
  /** Previous geometry of a part the edit did not touch (orientation and pin sides are kept). */
  const prevOf = (id: string) => (opts.previous && !affected.has(id) ? opts.previous.parts[id] : undefined);
  /** Previous position of any part that existed before (positions and order are kept where possible). */
  const prevPos = (id: string): { at: Pt } | undefined => opts.previous?.parts[id] ?? (newOrigins.has(id) ? { at: newOrigins.get(id)! } : undefined);
  /** Incremental mode: where a new part starts (below the existing drawing; set before the solve). */
  const newOrigins = new Map<string, Pt>();
  const circuit = project.circuit;
  const defs = pinDefsOf(circuit);
  if (!circuit.parts.length) return { status: "invalid_input", pinDefs: defs, issues: ["the circuit has no parts, so there is nothing to draw."], notes };
  for (const p of circuit.parts) if (!defs[p.id]) return { status: "invalid_input", pinDefs: defs, issues: [`E201 unknown part type "${p.type}" (${p.id}).`], notes };
  for (const s of Object.values(BUILTIN)) checkSymbol(s);
  const v = validate(circuit, defs);
  if (!v.valid) return { status: "invalid_input", pinDefs: defs, issues: v.issues.map((i) => `${i.code} ${i.message}`), notes };
  const vc = v.valid;
  const ncSet = new Set(vc.nc.map(canonical));

  // Which terminals are drawn, and for which net (SPEC 6.2 "as written", group representative).
  const drawnNet = new Map<string, string>(); // "R1[1]" -> net id
  for (const [netId, eps] of vc.endpoints) for (const ep of eps) {
    const num = ep.kind === "terminal" ? ep.number : groupRepresentative(ep.part, ep.group, defs, ncSet)!;
    drawnNet.set(`${ep.part}[${num}]`, netId);
  }
  const netById = new Map(circuit.nets.map((n) => [n.id, n]));

  // Step 3: named power and ground nets become ports (src/layout/ports.ts); everything else is wired.
  const typeOfPart = new Map(circuit.parts.map((p) => [p.id, p.type]));
  const portNet = new Set<string>();
  for (const n of circuit.nets) if (drawnAsPorts(n, [...new Set(vc.endpoints.get(n.id)!.map(canonical))], (p) => typeOfPart.get(p))) portNet.add(n.id);
  const wired = circuit.nets.filter((n) => !portNet.has(n.id));
  const keepsPreviousLock = (id: string) => {
    const lock = locks.get(id), prev = opts.previous?.parts[id];
    return !lock || (prev && lock.x === prev.at[0] && lock.y === prev.at[1] && lock.rot === prev.orient.rot && lock.flip === prev.orient.flip);
  };
  const decouplers = opts.place || opts.decoupling === false ? [] : decouplingMatches(circuit, defs, vc, drawnNet, portNet, hints)
    .filter((m) => keepsPreviousLock(m.part) && !orientHint.has(m.part) && !orientHint.has(m.host)
      && !hints.some((h) => (h.type === "relative" && (h.part === m.part || h.of === m.part)) || (h.type === "align" && h.parts.includes(m.part))));
  const decouplerOf = new Map(decouplers.map((m) => [m.part, m]));
  // Room a child slot needs beside its pin (host -> pin -> distance to a neighbouring top pin): 2 G
  // to the capacitor's pin, 1 G to its outline, its label, and 1 G clear of the neighbour's wire.
  const slotRoom = new Map<string, Map<string, number>>();
  for (const m of decouplers) {
    const cap = circuit.parts.find((p) => p.id === m.part)!, sym = BUILTIN[cap.type];
    if (!sym) continue;
    const w = Math.max(...labelLines(cap, sym).map((l) => measure(l, LABEL_SIZE).width / 10));
    const pins = slotRoom.get(m.host) ?? new Map<string, number>();
    pins.set(m.pin, Math.max(pins.get(m.pin) ?? 0, 4 + Math.ceil(w + 0.4)));
    slotRoom.set(m.host, pins);
  }

  // Adjacency over wired nets.
  const partsOfNet = new Map<string, string[]>();
  for (const n of circuit.nets) partsOfNet.set(n.id, [...new Set(vc.endpoints.get(n.id)!.map((e) => e.part))].sort(cmpStr));
  const neighbours = new Map<string, Set<string>>(circuit.parts.map((p) => [p.id, new Set<string>()]));
  for (const n of wired) for (const a of partsOfNet.get(n.id)!) for (const b of partsOfNet.get(n.id)!) if (a !== b) neighbours.get(a)!.add(b);
  const ids = circuit.parts.map((p) => p.id).sort(cmpStr);
  const partOf = new Map(circuit.parts.map((p) => [p.id, p]));

  // Step 1: templates matched on the full graph (SPEC 9.4). Each region becomes one block.
  const skip = new Set(opts.templates ? opts.templates.skip : []);
  let regions = opts.place || opts.templates === false ? [] : matchTemplates({ parts: circuit.parts, defs, drawnNet, netById, portNet }, TEMPLATES, skip);
  // Templates that require a power rail reserve space above it. Use general placement
  // when that rail is negative so a pull resistor can hang below the signal.
  regions = regions.filter((r) => ![...r.nets].some(([name, id]) => {
    const kinds = r.template.nets[name]?.kind;
    return kinds?.length === 1 && kinds[0] === "power" && railLevel(netById.get(id)!) === -1;
  }));
  // Vertical stacks (src/layout/stacks.ts) take the parts no larger template holds. The one-part
  // templates and the LED pair give way to a stack: it draws them the same way and adds their place.
  const spatialHints = new Set(hints.filter((h) => h.type === "relative" || h.type === "align" || h.type === "orient").flatMap(hintParts));
  const heldByIntent = (id: string) => locks.has(id) || spatialHints.has(id);
  const GIVES_WAY = new Set(["pull-up", "pull-down", "led-series", "led-series-vertical"]);
  let stacks: Stack[] = [];
  if (!opts.place && opts.stacks !== false) {
    const inRegion = new Map<string, Region>(), isLink = new Set<string>();
    for (const r of regions) { for (const p of r.members) inRegion.set(p, r); for (const p of r.links) isLink.add(p); }
    const held = (id: string) => heldByIntent(id) || decouplerOf.has(id) || isLink.has(id);
    stacks = findStacks({ parts: circuit.parts, drawnNet, net: (id) => netById.get(id)!, portNet,
      free: (id) => !held(id) && (!inRegion.has(id) || GIVES_WAY.has(inRegion.get(id)!.template.id)), loose: (id) => !inRegion.has(id) });
    const taken = new Set(stacks.flatMap((st) => [st.root, ...st.children.map((c) => c.part)]));
    regions = regions.filter((r) => !r.members.some((m) => taken.has(m)));
  }
  const stackRoot = new Map(stacks.flatMap((st) => st.children.map((c) => [c.part, st.root] as const)));
  const bridgeTopOpamp = new Set(stacks.flatMap((st) => (st.bridgeOpamps ? [st.bridgeOpamps[0]] : [])));
  const regionOf = new Map<string, Region>(), linkOf = new Map<string, Region>();
  for (const r of regions) { for (const p of r.members) regionOf.set(p, r); for (const p of r.links) linkOf.set(p, r); }
  const blockOf = (id: string) => regionOf.get(id)?.rep ?? id;
  const membersOf = (b: string) => regionOf.get(b)?.members ?? [b];
  const reps = ids.filter((id) => blockOf(id) === id);
  // A stack's children are ordered with their root (they are placed against it).
  const rigid = new Map<string, { host: string; at: Pt }>();
  const blockGraph = (adj: Map<string, Set<string>>) => {
    const of = (id: string) => rigid.get(id)?.host ?? blockOf(id);
    const g = new Map(reps.map((b) => [b, new Set<string>()]));
    for (const a of ids) for (const b of adj.get(a)!) if (of(a) !== of(b)) g.get(of(a))!.add(of(b));
    return g;
  };
  // Step 2: flow inference on the block graph (src/layout/flow.ts); templates may fix ranks.
  const isSource = (id: string) => BUILTIN[partOf.get(id)!.type]?.kind === "source" || partOf.get(id)!.props?.controller === "true" || partOf.get(id)!.props?.flow === "input";
  // For flow, a stack is one block with its root.
  const flowBlock = (id: string) => stackRoot.get(id) ?? blockOf(id);
  const stackKids = new Map<string, string[]>();
  for (const [c, root] of stackRoot) stackKids.set(root, [...(stackKids.get(root) ?? []), c]);
  const flowGraph: FlowGraph = {
    blocks: reps.filter((b) => !stackRoot.has(b)), members: (b) => [...membersOf(b), ...(stackKids.get(b) ?? [])], blockOf: flowBlock, type: (id) => partOf.get(id)!.type, label: (id) => partOf.get(id)!.props?.label, defs, drawnNet,
    net: (id) => netById.get(id)!, portNet, isSource,
    attached: new Map(decouplers.filter((m) => !regionOf.has(m.part)).map((m) => [m.part, m.host])),
  };
  const fixedRank = new Map<string, number>();
  const first = inferFlow(flowGraph, fixedRank), natural = first.rank;
  for (const r of regions) for (const [p, k] of templateRanks(r, (q) => natural.get(blockOf(q))!)) {
    fixedRank.set(blockOf(p), Math.min(k, fixedRank.get(blockOf(p)) ?? k));
  }
  const flow = fixedRank.size ? inferFlow(flowGraph, fixedRank) : first;
  for (const b of flow.guessed) notes.push(`${b}: nothing says where the signal starts, so the left-to-right order is a guess (low confidence).`);
  const brank = flow.rank;
  const rank = new Map(ids.map((id) => [id, brank.get(flowBlock(id))!]));
  const colValue = new Map(ids.map((id) => [id, flow.col.get(flowBlock(id))!]));
  // Incremental mode (SPEC 9.5): existing parts keep their previous column. Adding or removing a
  // connection changes graph distances, and re-ranking would slide whole columns of untouched parts.
  // A new part joins the previous column of the existing parts its fresh ranking puts it with; with
  // no such parts, it takes the mean of its wired neighbours' columns. A previous layout saved
  // without columns (an older engine) uses each part's x as its column.
  const legacy = !!opts.previous && Object.values(opts.previous.parts).every((p) => p.column === undefined);
  const oldCol = (id: string) => { const p = opts.previous?.parts[id]; return p ? (legacy ? p.at[0] : p.column) : undefined; };
  if (opts.previous && ids.some((id) => oldCol(id) !== undefined)) {
    const fresh = new Map(colValue);
    for (const id of ids) {
      if (oldCol(id) !== undefined) { colValue.set(id, oldCol(id)!); continue; }
      const votes = new Map<number, number>();
      for (const o of ids) if (o !== id && oldCol(o) !== undefined && fresh.get(o) === fresh.get(id)) votes.set(oldCol(o)!, (votes.get(oldCol(o)!) ?? 0) + 1);
      const peer = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      const near = [...neighbours.get(id)!].sort(cmpStr).flatMap((n) => (oldCol(n) !== undefined ? [oldCol(n)!] : []));
      colValue.set(id, peer ?? (near.length ? near.reduce((a, b) => a + b, 0) / near.length : fresh.get(id)!));
    }
  }
  const sortedColumns = () => [...new Set(colValue.values())].sort((a, b) => a - b);
  let colVals = sortedColumns();
  const colOf = new Map(ids.map((id) => [id, colVals.indexOf(colValue.get(id)!)]));

  // Average column of the other parts on a net (for pin sides and left/right choice).
  const netCol = (netId: string, self: string) => {
    const others = partsOfNet.get(netId)!.filter((p) => p !== self);
    return others.length ? others.reduce((s, p) => s + colOf.get(p)!, 0) / others.length : undefined;
  };

  // Steps 3b and 4: orientation, measurement, labels, ports.
  const placed = new Map<string, Placed>();
  const measurePart = (id: string, force?: Orient): void => {
    const part = partOf.get(id)!;
    const col = colOf.get(id)!;
    const tr = regionOf.get(id) ?? linkOf.get(id);
    let sym: SymbolDef;
    let orient: Orient = { rot: 0, flip: false };
    if (BUILTIN[part.type]) {
      sym = BUILTIN[part.type]!;
      if (sym.kind === "source") orient = { rot: 90, flip: false }; // "+" (left pin) up
      else if (sym.kind === "two-pin") orient = twoPinOrient(sym, id, drawnNet, netById, portNet, col, netCol);
      else orient = defaultOrient(sym, id, { drawnNet, netById, portNet, col, netCol }) ?? orient;
    } else if (part.type === HEADER) {
      sym = headerFor(defs[id]!);
      orient = defaultOrient(sym, id, { drawnNet, netById, portNet, col, netCol }) ?? orient;
    } else {
      // Pin sides: fixed placement, hint, previous layout; pins none of those name keep the
      // template's side, after the other pins of that side.
      const given = opts.place?.[id]?.sides ?? sidesHint.get(id) ?? prevOf(id)?.sides ?? opts.pinOrder?.[id];
      const named = new Set(Object.values(given ?? {}).flat());
      const tpl = Object.fromEntries(Object.entries((tr ? templateSides(tr, id) : undefined) ?? {})
        .map(([side, ns]) => [side, (ns ?? []).filter((n) => !named.has(n))] as const).filter(([, ns]) => ns.length));
      sym = icFor(id, defs[id]!, drawnNet, netById, ncSet, col, netCol, given, tpl, slotRoom.get(id));
    }
    // Orientation precedence: fixed placement, lock, orient hint, previous layout, template, default.
    const lockOf = locks.get(id), oh = orientHint.get(id), prev = prevOf(id), to = tr ? templateOrient(tr, id, sym) : undefined;
    if (force) orient = force;
    else if (opts.place?.[id]?.orient) orient = opts.place[id]!.orient!;
    else if (lockOf) orient = { rot: lockOf.rot, flip: lockOf.flip };
    else if (oh) orient = { rot: oh.rot, flip: oh.flip };
    else if (prev) orient = prev.orient;
    else if (to) orient = to;
    else if (opts.opampOrient?.[id]) orient = opts.opampOrient[id]!;
    else if (bridgeTopOpamp.has(id)) orient = { rot: 180, flip: true };
    const ko = xformBox(keepOut(sym), [0, 0], orient);
    const pins = sym.pins
      .filter((p) => drawnNet.has(`${id}[${p.number}]`) || ncSet.has(`${id}[${p.number}]`) || sym.kind !== "ic")
      .map((p) => ({ number: p.number, at: xformPt(p.at, [0, 0], orient), dir: xformDir(p.dir, orient) }));
    const ports: Placed["ports"] = [];
    for (const p of pins) {
      const netId = drawnNet.get(`${id}[${p.number}]`);
      if (!netId || !portNet.has(netId)) continue;
      const net = netById.get(netId)!;
      const kind = netKind(net) === "ground" ? "ground" : "power";
      const want: Dir = railLevel(net) === 1 ? "up" : "down";
      // A side pin's stub runs out far enough that the symbol and its text clear the part.
      const half = Math.max(1, (portText(kind, net) ? measure(portText(kind, net)!, LABEL_SIZE).width / 10 : 0) / 2);
      const out = isHorizontal(p.dir) ? Math.max(1, Math.ceil(half)) : 1;
      let stub: Pt[];
      if (p.dir === want) stub = [];
      else if (isHorizontal(p.dir)) stub = [p.at, step(p.at, p.dir, out), step(step(p.at, p.dir, out), want)];
      else {
        // The pin faces away from where the symbol must point (a flipped pull-up): leave the pin,
        // step sideways clear of the part, and enter the symbol from the correct side.
        const a = step(p.at, p.dir, 2), b = step(a, "right", Math.ceil(half) + 2);
        stub = [p.at, a, b, step(b, want)];
      }
      const anchor = stub.length ? stub[stub.length - 1]! : p.at;
      ports.push({ pin: p.number, net, anchor, stub, kind, box: portBox(kind, net, anchor) });
    }
    // Labels must keep clear of port symbols and of every pin's approach point.
    const approachBoxes = pins.map((p): Box => { const a = step(p.at, p.dir); return { x: a[0] - 0.5, y: a[1] - 0.5, w: 1, h: 1 }; });
    const hostDec = decouplers.filter((m) => m.host === id);
    const decRight = hostDec.length > 0 && hostDec.every((m) => {
      const tp = pins.find((p) => p.number === m.pin);
      return tp !== undefined && tp.at[0] > ko.x + ko.w / 2;
    });
    const labels = labelFor(part, sym, orient, ko, [...ports.map((q) => q.box), ...approachBoxes], intent.overrides?.labelSide?.[id]
      ?? (tr ? templateLabel(tr, id) : undefined), !tr, hostDec.length > 0 ? (decRight ? "below-right" : "below-left") : undefined);
    let env = ko;
    for (const l of labels) env = unionBox(env, gridBox(l.box));
    for (const q of ports) env = unionBox(env, q.box);
    placed.set(id, { id, sym, orient, col, rank: rank.get(id)!, ko, labels, ports, env, pins });
  };
  for (const id of ids) measurePart(id);

  // Decoupling child slots reserve an envelope with their host. Parts still keep their own
  // render geometry and electrical identity; the slot never changes a circuit connection.
  const childOffsets = new Map<string, { host: string; at: Pt }>();
  const childWires = new Map<string, Array<{ host: string; run: Pt[] }>>();
  const clusterEnv = new Map(ids.map((id) => [id, placed.get(id)!.env]));
  const shifted = (b: Box, p: Pt): Box => ({ ...b, x: b.x + p[0], y: b.y + p[1] });
  const footprint = (p: Placed) => [p.ko, ...p.labels.map((l) => gridBox(l.box)), ...p.ports.map((q) => q.box)];
  for (const m of decouplers) {
    const host = placed.get(m.host)!, cap = placed.get(m.part)!;
    const target = host.pins.find((p) => p.number === m.pin)!;
    const supply = cap.pins.find((p) => p.number === m.supplyPin)!;
    if (target.dir !== "up" || supply.dir !== "up") continue;
    // A shared pin's slot fills left to right, smallest capacitance first (decouplingMatches order).
    const shared = decouplers.filter((d) => d.host === m.host && d.pin === m.pin).length > 1;
    const preferLeft = shared || target.at[0] <= host.ko.x + host.ko.w / 2;
    const sides = preferLeft ? ["left", "right"] : ["right", "left"];
    const movedPorts = new Set([m.pin, ...decouplers.filter((d) => d.host === m.host && childOffsets.has(d.part)).map((d) => d.pin)]);
    const occupied = [host.ko, ...host.labels.map((l) => gridBox(l.box)), ...host.ports.filter((p) => !movedPorts.has(p.pin)).map((p) => p.box),
      ...[...childOffsets].filter(([, c]) => c.host === m.host).flatMap(([id, c]) => footprint(placed.get(id)!).map((b) => shifted(b, c.at))),
      // The wire into every other top pin of the host leaves straight up past the slot.
      ...host.pins.filter((p) => p.dir === "up" && p.number !== m.pin && !movedPorts.has(p.number))
        .map((p): Box => ({ x: p.at[0] - 0.5, y: p.at[1] - 10, w: 1, h: 10 }))];
    for (const side of sides) {
      const at: Pt = [target.at[0] + (side === "left" ? -2 : 2) - supply.at[0], target.at[1] - 6 - supply.at[1]];
      const approach = cap.pins.map((p): Box => { const a = step(p.at, p.dir); return { x: a[0] - 0.5, y: a[1] - 0.5, w: 1, h: 1 }; });
      const labels = labelFor(partOf.get(m.part)!, cap.sym, cap.orient, cap.ko, [...cap.ports.map((p) => p.box), ...approach], intent.overrides?.labelSide?.[m.part] ?? side);
      let env = cap.ko;
      for (const l of labels) env = unionBox(env, gridBox(l.box));
      const ports = cap.ports.filter((p) => p.pin !== m.supplyPin);
      for (const p of ports) env = unionBox(env, p.box);
      const boxes = [cap.ko, ...labels.map((l) => gridBox(l.box)), ...ports.map((p) => p.box)].map((b) => shifted(b, at));
      if (occupied.some((b) => boxes.some((a) => boxesOverlap(b, a)))) continue;
      cap.labels = labels; cap.env = env; cap.ports = ports;
      childOffsets.set(m.part, { host: m.host, at });
      clusterEnv.set(m.host, unionBox(clusterEnv.get(m.host)!, shifted(env, at)));
      colOf.set(m.part, colOf.get(m.host)!);
      notes.push(`decoupling@1: ${m.part} placed next to ${m.host}[${m.pin}]`);
      break;
    }
  }
  // Share one supply port per served pin and draw the short connection explicitly.
  // The capacitor grounds retain their own ports; power nets stay separate virtual trees.
  for (const m of decouplers) {
    const child = childOffsets.get(m.part);
    if (!child) continue;
    const host = placed.get(m.host)!, cap = placed.get(m.part)!;
    const target = host.pins.find((p) => p.number === m.pin)!;
    const port = host.ports.find((p) => p.pin === m.pin);
    const supply = cap.pins.find((p) => p.number === m.supplyPin)!;
    if (!port) continue;
    const first = decouplers.find((c) => c.host === m.host && c.pin === m.pin && childOffsets.has(c.part))!;
    const firstOffset = childOffsets.get(first.part)!;
    const firstSupply = placed.get(first.part)!.pins.find((p) => p.number === first.supplyPin)!;
    const bus: Pt = step(target.at, "up", 8);
    const tap: Pt = [firstOffset.at[0] + firstSupply.at[0], bus[1]];
    port.anchor = step(tap, "up", 2);
    port.stub = [target.at, bus, tap, port.anchor];
    port.box = portBox(port.kind, port.net, port.anchor);
    cap.ports = cap.ports.filter((p) => p.pin !== m.supplyPin);
    const a: Pt = [child.at[0] + supply.at[0], child.at[1] + supply.at[1]];
    const runs = childWires.get(port.net.id) ?? [];
    runs.push({ host: m.host, run: [a, [a[0], bus[1]], bus] });
    childWires.set(port.net.id, runs);
  }
  // Vertical stacks: each child is turned to face its parent's pin and placed in line with it (or
  // beside the in-line child), in the root's frame. A child that cannot be turned (an untouched
  // part of an edit keeps its orientation) or has no room is left to the general rules.
  const sameOrient = (a: Orient, b: Orient) => a.rot === b.rot && a.flip === b.flip;
  const canTurn = (id: string, o: Orient) => { const prev = prevOf(id); return !prev || sameOrient(prev.orient, o); };
  /** Vertical, with this pin at the top or at the bottom. Pin 1 of a two-pin part is up at rotation 90. */
  const standing = (id: string, pin: string, at: "top" | "bottom"): Orient => {
    const first = placed.get(id)!.sym.pins[0]!.number === pin;
    return { rot: first === (at === "top") ? 90 : 270, flip: false };
  };
  for (const st of stacks) {
    if (st.rootUp !== undefined) {
      const o = standing(st.root, st.rootUp, "top");
      if (!canTurn(st.root, o)) continue;
      measurePart(st.root, o);
    }
    const frame = new Map<string, Pt>([[st.root, [0, 0]]]);
    const occupied = [...footprint(placed.get(st.root)!)];
    const laneZero = new Map<string, { x: number; y: number }>();
    for (const c of st.children) {
      const po = frame.get(c.parent);
      const pp = placed.get(c.parent)!.pins.find((p) => p.number === c.parentPin);
      if (!po || !pp || pp.dir !== c.dir) continue;
      // The edit fallback that puts new parts below the drawing keeps them out of stacks too.
      if (opts.newPartsBelow && opts.previous && !opts.previous.parts[c.part]) continue;
      const o = standing(c.part, c.pin, c.dir === "up" ? "bottom" : "top");
      if (!canTurn(c.part, o)) continue;
      measurePart(c.part, o);
      const C = placed.get(c.part)!, cp = C.pins.find((p) => p.number === c.pin)!;
      const sgn = c.dir === "up" ? -1 : 1, slot = `${c.parent}[${c.parentPin}]`;
      const boxes = footprint(C);
      const fits = (at: Pt) => !boxes.some((b) => occupied.some((q) => boxesOverlap(shifted(b, at), q)));
      let at: Pt | undefined;
      if (c.lane === 0) {
        for (let extra = 0; extra <= 3 && !at; extra++) {
          const tryAt: Pt = [po[0] + pp.at[0] - cp.at[0], po[1] + pp.at[1] + sgn * (c.gap + extra) - cp.at[1]];
          if (fits(tryAt)) at = tryAt;
        }
      } else {
        const z = laneZero.get(slot);
        for (let dx = 3; z && dx <= 16 && !at; dx++) {
          const tryAt: Pt = [z.x + dx - cp.at[0], z.y - cp.at[1]];
          // 1 G of air beside the neighbour, so a wire can pass between the two.
          if (fits(tryAt) && fits([tryAt[0] - 1, tryAt[1]])) at = tryAt;
        }
      }
      // An edit: a part it did not touch joins a stack only where it already stood (SPEC 9.5).
      const was = opts.previous?.parts[c.part], rootWas = opts.previous?.parts[st.root];
      if (at && was && !affected.has(c.part) && !(rootWas && was.at[0] - rootWas.at[0] === at[0] && was.at[1] - rootWas.at[1] === at[1])) at = undefined;
      if (!at) { measurePart(c.part); continue; }
      laneZero.set(slot, { x: at[0] + cp.at[0], y: at[1] + cp.at[1] });
      frame.set(c.part, at);
      const placedAt = at;
      occupied.push(...boxes.map((b) => shifted(b, placedAt)));
      rigid.set(c.part, { host: st.root, at });
      notes.push(`stack: ${c.part} ${c.dir === "up" ? "above" : "below"} ${c.parent}[${c.parentPin}]`);
    }
  }
  for (const id of ids) {
    const p = placed.get(id)!;
    p.env = footprint(p).reduce(unionBox);
    clusterEnv.set(id, p.env);
  }
  for (const [id, child] of [...childOffsets, ...rigid]) clusterEnv.set(child.host, unionBox(clusterEnv.get(child.host)!, shifted(placed.get(id)!.env, child.at)));
  const envOf = (id: string) => clusterEnv.get(id)!;
  // A host's own envelope: without its child slots, and without the supply ports moved on top of them.
  const served = new Set(decouplers.filter((m) => childOffsets.has(m.part)).map((m) => `${m.host}[${m.pin}]`));
  const ownEnv = (id: string): Box => { const P = placed.get(id)!; return [P.ko, ...P.labels.map((l) => gridBox(l.box)), ...P.ports.filter((q) => !served.has(`${id}[${q.pin}]`)).map((q) => q.box)].reduce(unionBox); };
  const withoutStacks = (reason: string): LayoutResult => {
    const r = layout(project, { ...opts, stacks: false });
    r.notes.unshift(`stacks dropped: ${reason}`);
    return r;
  };
  const withoutDecoupling = (reason: string): LayoutResult => {
    const r = layout(project, { ...opts, decoupling: false });
    r.notes.unshift(`decoupling@1: child slots yielded to ${reason}; used generic placement`);
    return r;
  };

  // Step 5: region interiors, each solved on its own; a region then moves as one rigid block.
  // A host's envelope includes its decoupling child slots, so a template keeps room for them.
  const geo = (id: string): Geo => { const P = placed.get(id)!; return { pins: P.pins, ko: P.ko, env: envOf(id), own: ownEnv(id) }; };
  const interior = new Map<Region, Interior>();
  for (const r of regions) {
    const res = solveInterior(r, geo);
    if ("failed" in res) return retry(`template ${r.key} abandoned: ${res.failed}`, { ...opts, templates: { skip: [...skip, r.key] } });
    interior.set(r, res);
  }
  const offsetOf = (id: string): Pt => (regionOf.has(id) ? interior.get(regionOf.get(id)!)!.offsets.get(id)! : rigid.get(id)?.at ?? [0, 0]);
  const blockEnv = (b: string): Box => (regionOf.has(b) ? interior.get(regionOf.get(b)!)!.env : envOf(b));
  const blockNeighbours = blockGraph(neighbours);

  const groupOf = (b: string) => [...membersOf(b), ...[...rigid].filter(([, c]) => c.host === b).map(([id]) => id)];
  // Side-by-side lanes give neighbouring outputs room to feed tall branches. The branch on
  // the higher pin stands further out, so its wire can pass above every branch closer to the chip.
  const fanStart = new Map<string, string>(); // branch net -> nearest branch in its group
  if (!opts.previous && opts.staggerBranches !== false && flow.seriesTaps.size > 1) {
    const fans = new Map<string, Array<{ block: string; row: number; net: string; top: number; bottom: number }>>();
    for (const [block, { entry, host }] of flow.seriesTaps) {
      const load = pinInfo(entry, placed), driver = pinInfo(host, placed);
      const col = colOf.get(block)!;
      const role = defs[driver.part]!.find((p) => p.number === driver.number)?.role;
      if (placed.get(driver.part)!.sym.kind !== "ic" || (role !== "output" && role !== "bidir")) continue;
      if (driver.dir !== "right" || load.dir !== "up" || col <= colOf.get(driver.part)!) continue;
      const members = groupOf(block);
      if (members.length !== flowGraph.members(block).length || members.some(heldByIntent)) continue;
      const key = `${driver.part}|${col}`;
      const fan = fans.get(key) ?? [];
      const env = blockEnv(block);
      const row = driver.at[1];
      // Compare the space each branch would take if lined up with its driver in one column.
      const top = row + 2 - load.at[1] - offsetOf(load.part)[1] + env.y;
      fan.push({ block, row, net: drawnNet.get(entry)!, top, bottom: top + env.h });
      fans.set(key, fan);
    }
    for (const branches of fans.values()) {
      const fan = branches.filter((a) => branches.some((b) => a !== b && a.top < b.bottom + 2 && b.top < a.bottom + 2));
      if (fan.length < 2) continue;
      fan.sort((a, b) => b.row - a.row || cmpStr(a.block, b.block));
      const base = colValue.get(fan[0]!.block)!;
      const end = colVals[colOf.get(fan[0]!.block)! + 1] ?? base + 0.5;
      for (const [i, { block, net }] of fan.entries()) {
        const lane = base + (end - base) * i / fan.length;
        for (const id of groupOf(block)) colValue.set(id, lane);
        fanStart.set(net, fan[0]!.block);
      }
    }
    if (fanStart.size) {
      colVals = sortedColumns();
      for (const id of ids) colOf.set(id, colVals.indexOf(colValue.get(id)!));
      for (const [id, { host }] of childOffsets) colOf.set(id, colOf.get(host)!);
    }
  }
  const withoutStagger = (reason: string) => retry(`chip branch staggering dropped: ${reason}`, { ...opts, staggerBranches: false });
  // Ordering candidate B: barycentre sweeps (fixed count) within each column.
  const columns: string[][] = colVals.map((_, c) => reps.filter((id) => colOf.get(id) === c && !childOffsets.has(id) && !rigid.has(id)));
  // Standalone port-only blocks (batteries, power headers, port-only regulators) have no wires to
  // any column. Tuck each into the shortest main column within its valid rail-flow range so it
  // does not inflate an already tall column or widen a signal column beside it.
  if (!opts.previous && !opts.place) {
    const railFeeders = new Map<string, string[]>();
    for (const id of ids) {
      const p = partOf.get(id)!;
      for (const pin of placed.get(id)!.pins) {
        const netId = drawnNet.get(`${id}[${pin.number}]`);
        if (!netId || !portNet.has(netId) || netKind(netById.get(netId)!) !== "power") continue;
        const role = defs[id]?.find((d) => d.number === pin.number)?.role;
        const isPathFeeder = (p.type === "diode" || p.type === "schottky" || p.type === "fuse" || p.type === "spst")
          && ((p.type !== "diode" && p.type !== "schottky") || pin.number === "K");
        if ((BUILTIN[p.type]?.kind !== "source" && role === "power_out") || isPathFeeder) {
          railFeeders.set(netId, [...(railFeeders.get(netId) ?? []), blockOf(id)]);
        }
      }
    }
    const portOnly = reps.filter((id) => !childOffsets.has(id) && !rigid.has(id) && !regionOf.has(id) && !heldByIntent(id)
      && blockNeighbours.get(id)!.size === 0 && (placed.get(id)!.sym.kind === "header" || placed.get(id)!.sym.kind === "ic"));
    for (const id of portOnly) {
      const curC = colOf.get(id)!;
      if (columns[curC]!.length <= 1) continue; // already in its own column
      let minC = 0, maxC = columns.length - 1;
      const myRails = placed.get(id)!.pins
        .map((p) => ({ num: p.number, net: drawnNet.get(`${id}[${p.number}]`) }))
        .filter((p): p is { num: string; net: string } => p.net !== undefined && portNet.has(p.net) && netKind(netById.get(p.net)!) === "power");
      for (const { num, net } of myRails) {
        const role = defs[id]?.find((d) => d.number === num)?.role;
        const isOut = BUILTIN[partOf.get(id)!.type]?.kind !== "source" && role === "power_out";
        if (isOut) {
          for (const other of partsOfNet.get(net) ?? []) {
            const ob = blockOf(other);
            if (ob !== id && colOf.get(ob)! > curC) maxC = Math.min(maxC, colOf.get(ob)! - 1);
          }
        } else {
          for (const f of railFeeders.get(net) ?? []) {
            if (f !== id) minC = Math.max(minC, colOf.get(f)! + (placed.get(id)!.sym.kind === "header" ? 1 : 0));
          }
        }
      }
      const colH = (c: number) => columns[c]!.filter((x) => x !== id).reduce((s, x) => s + blockEnv(x).h + 2, 0);
      let bestC = curC, bestH = colH(curC);
      for (let c = minC; c <= maxC; c++) {
        if (!Number.isInteger(colVals[c]!) || !columns[c]!.length) continue;
        const h = colH(c);
        if (h < bestH || (h === bestH && Math.abs(c - curC) < Math.abs(bestC - curC))) { bestC = c; bestH = h; }
      }
      if (bestC !== curC) {
        columns[curC] = columns[curC]!.filter((x) => x !== id);
        if (placed.get(id)!.sym.kind === "source") columns[bestC]!.unshift(id);
        else columns[bestC]!.push(id);
        colOf.set(id, bestC);
        colValue.set(id, colVals[bestC]!);
      }
    }
  }
  for (let sweep = 0; sweep < 4; sweep++) {
    const forward = sweep % 2 === 0;
    const order = forward ? columns.map((_, i) => i) : columns.map((_, i) => columns.length - 1 - i);
    for (const c of order) {
      const ref = forward ? c - 1 : c + 1;
      if (ref < 0 || ref >= columns.length) continue;
      // Neighbours count in the nearest column on that side that has any (a column of taps may lie between).
      const side = forward ? columns.slice(0, c).reverse() : columns.slice(c + 1);
      const posIn = side.map((col) => new Map(col.map((id, i) => [id, i])));
      const posOf = (id: string) => posIn.find((m) => [...blockNeighbours.get(id)!].some((n) => m.has(n))) ?? posIn[0]!;
      let pos = posIn[0]!;
      const cur = new Map(columns[c]!.map((id, i) => [id, i]));
      // Position of a neighbour = its index plus where the shared net's pin sits on it,
      // so pins that are higher on a neighbour pull their part higher (fewer crossings).
      const pinFrac = (n: string, self: string) => {
        const E = blockEnv(n), own = groupOf(self);
        const shared = groupOf(n).flatMap((m) => placed.get(m)!.pins
          .filter((p) => { const net = drawnNet.get(`${m}[${p.number}]`); return net !== undefined && !portNet.has(net) && partsOfNet.get(net)!.some((q) => own.includes(q)); })
          .map((p) => p.at[1] + offsetOf(m)[1]));
        if (!shared.length || E.h === 0) return 0.5;
        return shared.reduce((s, y) => s + (y - E.y) / E.h, 0) / shared.length;
      };
      const bary = (id: string) => {
        pos = posOf(id);
        const ns = [...blockNeighbours.get(id)!].filter((n) => pos.has(n));
        return ns.length ? ns.reduce((s, n) => s + pos.get(n)! + pinFrac(n, id), 0) / ns.length : cur.get(id)! + 0.5;
      };
      columns[c] = [...columns[c]!].sort((a, b) => bary(a) - bary(b) || cur.get(a)! - cur.get(b)! || cmpStr(a, b));
    }
  }
  // Port-only two-pin parts stacked in a shared column (such as an unhinted bypass capacitor)
  // sit below the wired parts so they do not push the main signal row down.
  if (!opts.previous && !opts.place) for (let c = 0; c < columns.length; c++) {
    const isPortCap = (id: string) => !regionOf.has(id) && !heldByIntent(id)
      && blockNeighbours.get(id)!.size === 0 && placed.get(id)!.sym.kind === "two-pin";
    if (columns[c]!.length > 1 && columns[c]!.some(isPortCap)) {
      columns[c] = [...columns[c]!.filter((id) => !isPortCap(id)), ...columns[c]!.filter(isPortCap)];
    }
  }
  // Incremental fallback: a new part starts below the existing drawing, under the parts of its column,
  // so no existing part has to make room for it (SPEC 9.5 stability). The spot is its soft anchor.
  if (opts.previous && opts.newPartsBelow) {
    const was = (id: string) => opts.previous!.parts[id];
    let bottom = Math.max(MARGIN, ...ids.filter((id) => was(id)).map((id) => was(id)!.at[1] + envOf(id).y + envOf(id).h));
    for (const col of columns) for (const id of col) {
      if (was(id)) continue;
      const e = blockEnv(id);
      const xs = col.flatMap((o) => (was(o) ? [was(o)!.at[0]] : []));
      const near = xs.length ? xs : [...neighbours.get(id)!].sort(cmpStr).flatMap((o) => (was(o) ? [was(o)!.at[0]] : []));
      const x = near.length ? Math.round(near.reduce((a, b) => a + b, 0) / near.length) : MARGIN - e.x;
      newOrigins.set(id, [Math.max(MARGIN - e.x, x), bottom + 2 - e.y]);
      bottom += 2 + e.h;
    }
  }
  // Incremental mode: parts from the previous layout keep their previous top-to-bottom order;
  // new or affected parts keep the slots the sweeps gave them (SPEC 9.5 ordering cost).
  if (opts.previous) for (let c = 0; c < columns.length; c++) {
    const col = columns[c]!;
    const kept = col.filter((id) => prevPos(id)).sort((a, b) => prevPos(a)!.at[1] - prevPos(b)!.at[1] || cmpStr(a, b));
    let k = 0;
    columns[c] = col.map((id) => (prevPos(id) ? kept[k++]! : id));
  }

  // Step 6: difference constraints in x and y.
  // setSpacing factor f adds round((f - 1) * 4) G to every gap.
  const spacing = (opts.spacing ?? 0) + Math.max(0, Math.round(((intent.spacing ?? 1) - 1) * 4));
  const spans = (i: number) => wired.filter((n) => {
    const cs = partsOfNet.get(n.id)!.map((p) => colOf.get(p)!);
    const last = Math.max(...cs);
    const start = fanStart.get(n.id);
    // A staggered branch wire runs straight over the nearer branches. Only its last channel
    // needs a vertical track for the turn into the branch.
    if (start !== undefined && i >= colOf.get(start)! - 1 && i < last - 1) return false;
    return Math.min(...cs) <= i && last >= i + 1;
  }).length;
  // Nets inside one template region are routed in its reserved corridors, not in the channels.
  const inRegion = (netId: string) => { const ps = partsOfNet.get(netId)!; return ps.length >= 2 && regionOf.has(ps[0]!) && ps.every((p) => regionOf.get(p) === regionOf.get(ps[0]!)); };
  const internal = (c: number) => wired.filter((n) => { const ps = partsOfNet.get(n.id)!; return ps.length >= 2 && !inRegion(n.id) && ps.every((p) => colOf.get(p) === c); }).length;
  const through = (c: number) => wired.filter((n) => { const cs = partsOfNet.get(n.id)!.map((p) => colOf.get(p)!); return Math.min(...cs) < c && Math.max(...cs) > c; }).length;
  const cons: Constraint[] = [];
  const vx = (id: string) => `x:${id}`, vy = (id: string) => `y:${id}`;
  for (const id of ids) {
    // The export bounds supply the margin. A wider label on an existing drawing may
    // expand those bounds leftward without pushing its part and unrelated routes.
    if (opts.previous) continue;
    const e = envOf(id);
    cons.push({ a: vx(id), b: X0, c: MARGIN - e.x, priority: "structural", why: `margin ${id}` });
    cons.push({ a: vy(id), b: X0, c: MARGIN - e.y, priority: "structural", why: `margin ${id}` });
  }
  // Incremental mode: two untouched parts whose present outlines would still clear each other (by
  // 1 G) at their previous positions need no more distance than they had. The channel widths count
  // crossing nets, so an edit that adds one net would otherwise slide whole columns. Next to an
  // affected part the full gap stands, so the part the edit changed can make room for itself.
  const keptGap = (a: string, b: string, axis: 0 | 1, need: number): number => {
    const pa = opts.previous?.parts[a], pb = opts.previous?.parts[b];
    if (!pa || !pb || affected.has(a) || affected.has(b)) return need;
    const ea = shift(blockEnv(a), pa.at), eb = shift(blockEnv(b), pb.at);
    const clear = ea.x + ea.w + 1 <= eb.x || eb.x + eb.w + 1 <= ea.x || ea.y + ea.h + 1 <= eb.y || eb.y + eb.h + 1 <= ea.y;
    return clear ? Math.min(need, pb.at[axis] - pa.at[axis]) : need;
  };
  for (let c = 0; c + 1 < columns.length; c++) {
    const gap = 2 + spans(c) + internal(c) + internal(c + 1) + spacing;
    for (const a of columns[c]!) for (const b of columns[c + 1]!) {
      const ea = blockEnv(a), eb = blockEnv(b);
      // Incremental mode: two parts that existed before and were not side by side (their rows
      // did not overlap, with 1 G to spare) need no horizontal separation (SPEC 9.5 stability).
      const pa = prevPos(a), pb = prevPos(b);
      if (pa && pb && (pa.at[1] + ea.y + ea.h + 1 <= pb.at[1] + eb.y || pb.at[1] + eb.y + eb.h + 1 <= pa.at[1] + ea.y)) continue;
      cons.push({ a: vx(b), b: vx(a), c: keptGap(a, b, 0, gap + ea.x + ea.w - eb.x), priority: "structural", why: `column ${c} before ${c + 1}` });
    }
  }
  // Parts a template keeps apart sideways (staggered sources) are not stacked.
  const apart = new Set(regions.flatMap((r) => apartPairs(r).flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`])));
  for (let c = 0; c < columns.length; c++) {
    const col = columns[c]!;
    const gapY = 2 + through(c) + spacing;
    for (let i = 0; i + 1 < col.length; i++) {
      if (apart.has(`${col[i]}|${col[i + 1]}`)) continue;
      const ea = blockEnv(col[i]!), eb = blockEnv(col[i + 1]!);
      // If the upper block has a wired down-facing pin on its bottom edge, leave 3 G to the next
      // block so a corner wire at pin.y + 2 clears the lower block's top edge (avoiding a 1 G jog).
      const hasBottomWire = groupOf(col[i]!).some((m) => placed.get(m)!.pins.some((p) => {
        const net = drawnNet.get(`${m}[${p.number}]`);
        return net !== undefined && !portNet.has(net) && p.dir === "down" && p.at[1] + offsetOf(m)[1] >= ea.y + ea.h;
      }));
      const needY = Math.max(gapY, hasBottomWire ? 3 : 0);
      cons.push({ a: vy(col[i + 1]!), b: vy(col[i]!), c: keptGap(col[i]!, col[i + 1]!, 1, needY + ea.y + ea.h - eb.y), priority: "structural", why: `order in column ${c}` });
    }
  }
  // Bus corridors: a template run that crosses columns (an I2C trunk from the controller to its
  // peripherals) keeps its rows clear. A part in a column the run crosses sits wholly above the rows
  // when its wires to the run's owner leave the owner above them, wholly below when they leave below;
  // a part with no wire to the owner, or one on the bus itself, is left alone.
  for (const r of regions) {
    const rows = trunkRows(r, geo);
    for (const owner of [...new Set(rows.map((x) => x.part))].sort(cmpStr)) {
      const mine = rows.filter((x) => x.part === owner);
      const top = Math.min(...mine.map((x) => x.off)), bottom = Math.max(...mine.map((x) => x.off));
      const bus = new Set(mine.map((x) => x.net));
      const cols = [...new Set(mine.flatMap((x) => x.ends))].map((p) => colOf.get(p)!);
      const priority = opts.previous ? "templateSoft" : "template";
      for (let c = Math.min(...cols) + 1; c < Math.max(...cols); c++) {
        const above: string[] = [], below: string[] = [];
        for (const b of columns[c]!) {
          if (regionOf.get(b) === r) continue;
          const nets = new Set(membersOf(b).flatMap((m) => placed.get(m)!.pins.map((p) => drawnNet.get(`${m}[${p.number}]`)!)).filter((n) => n && !portNet.has(n)));
          if ([...nets].some((n) => bus.has(n))) continue;
          const ys = placed.get(owner)!.pins.filter((p) => nets.has(drawnNet.get(`${owner}[${p.number}]`)!)).map((p) => p.at[1]);
          if (!ys.length) continue;
          const y = ys.reduce((a, v) => a + v, 0) / ys.length, E = blockEnv(b);
          if (y < top) {
            above.push(b);
            cons.push({ a: vy(owner), b: vy(b), c: E.y + E.h - top + 1, priority, why: `bus corridor: ${b} above the ${r.template.id} rows` });
          } else if (y > bottom) {
            below.push(b);
            cons.push({ a: vy(b), b: vy(owner), c: bottom + 1 - E.y, priority, why: `bus corridor: ${b} below the ${r.template.id} rows` });
          }
        }
        // In a fresh layout, more weakly: the parts above stay stacked just over the rows and the
        // parts below just under them, so their wires to the owner stay short (in an edit, staying
        // put decides instead). Each keeps at most 2 G more than the gap it needs to its neighbour.
        if (opts.previous) continue;
        const gapY = 2 + through(c) + spacing;
        const close = (upper: string, lower: string) => {
          const eu = blockEnv(upper), el = blockEnv(lower);
          cons.push({ a: vy(upper), b: vy(lower), c: -(eu.y + eu.h + gapY - el.y + 2), priority: "align", why: `bus corridor: ${upper} close above ${lower}` });
        };
        for (let i = 0; i + 1 < above.length; i++) close(above[i]!, above[i + 1]!);
        for (let i = 0; i + 1 < below.length; i++) close(below[i]!, below[i + 1]!);
        const last = above.at(-1), first = below[0];
        if (last) { const E = blockEnv(last); cons.push({ a: vy(last), b: vy(owner), c: top - 3 - E.y - E.h, priority: "align", why: `bus corridor: ${last} just above the ${r.template.id} rows` }); }
        if (first) { const E = blockEnv(first); cons.push({ a: vy(owner), b: vy(first), c: E.y - bottom - 3, priority: "align", why: `bus corridor: ${first} just below the ${r.template.id} rows` }); }
      }
    }
  }
  // Regions are rigid blocks; templates link them to the parts around them (SPEC 9.2 step 6).
  for (const r of regions) {
    for (const m of r.members) if (m !== r.rep) {
      const o = offsetOf(m);
      cons.push(...eq(vx(m), vx(r.rep), o[0], "structural", `region ${r.key}`), ...eq(vy(m), vy(r.rep), o[1], "structural", `region ${r.key}`));
    }
    // Incremental mode: untouched parts staying put wins over the template's links (SPEC 9.5).
    cons.push(...linkConstraints(r, geo, opts.previous ? "templateSoft" : "template"));
  }
  const vars = ids.flatMap((id) => [vx(id), vy(id)]);
  for (const [id, child] of childOffsets) cons.push(...eq(vx(id), vx(child.host), child.at[0], "template", `decoupling ${id}`), ...eq(vy(id), vy(child.host), child.at[1], "template", `decoupling ${id}`));
  for (const [id, child] of rigid) cons.push(...eq(vx(id), vx(child.host), child.at[0], "template", `stack ${id}`), ...eq(vy(id), vy(child.host), child.at[1], "template", `stack ${id}`));
  // Symmetric op-amp feedback bridge: align the top and bottom op-amp outputs to the outer ends of the vertical ladder.
  if (!opts.previous) for (const st of stacks) {
    if (!st.bridgeOpamps || st.children.length < 2) continue;
    const [topOp, botOp] = st.bridgeOpamps;
    const botPart = st.children[st.children.length - 1]!.part;
    if (!rigid.has(botPart)) continue;
    const topOut = placed.get(topOp)?.pins.find((p) => p.number === "1");
    const botOut = placed.get(botOp)?.pins.find((p) => p.number === "1");
    const rTop = placed.get(st.root)?.pins.find((p) => p.dir === "up");
    const rBot = placed.get(botPart)?.pins.find((p) => p.dir === "down");
    if (topOut && rTop) cons.push(...eq(vy(topOp), vy(st.root), rTop.at[1] - 2 - topOut.at[1], "template", `bridge ${topOp}`));
    if (botOut && rBot) cons.push(...eq(vy(botOp), vy(botPart), rBot.at[1] + 2 - botOut.at[1], "template", `bridge ${botOp}`));
  }
  const known = new Set(ids);
  for (const l of locks.values()) if (known.has(l.part)) cons.push(...eq(vx(l.part), X0, l.x, "lock", `lock ${l.part}`), ...eq(vy(l.part), X0, l.y, "lock", `lock ${l.part}`));
  for (const h of hints) {
    if (h.type === "relative" && known.has(h.part) && known.has(h.of)) {
      const ep = placed.get(h.part)!.env, eo = placed.get(h.of)!.env;
      const why = `hint ${h.id}: ${h.part} ${h.rel} ${h.of}`;
      if (h.rel === "right-of") cons.push({ a: vx(h.part), b: vx(h.of), c: eo.x + eo.w + 2 - ep.x, priority: h.priority, why });
      if (h.rel === "left-of") cons.push({ a: vx(h.of), b: vx(h.part), c: ep.x + ep.w + 2 - eo.x, priority: h.priority, why });
      if (h.rel === "below") cons.push({ a: vy(h.part), b: vy(h.of), c: eo.y + eo.h + 2 - ep.y, priority: h.priority, why });
      if (h.rel === "above") cons.push({ a: vy(h.of), b: vy(h.part), c: ep.y + ep.h + 2 - eo.y, priority: h.priority, why });
    }
    if (h.type === "align") {
      const ps = h.parts.filter((x) => known.has(x));
      const al = (id: string) => { const P = placed.get(id)!; return xformPt(P.sym.align, [0, 0], P.orient); };
      for (let i = 1; i < ps.length; i++) {
        const [a, b] = [ps[i - 1]!, ps[i]!];
        if (h.axis === "row") cons.push(...eq(vy(b), vy(a), al(a)[1] - al(b)[1], h.priority, `hint ${h.id}: row ${ps.join(" ")}`));
        else cons.push(...eq(vx(b), vx(a), al(a)[0] - al(b)[0], h.priority, `hint ${h.id}: column ${ps.join(" ")}`));
      }
    }
  }
  // Incremental mode: untouched parts stay put. Lower bounds (never leftward or upward) keep the
  // solve feasible; upper bounds are dropped first when something must make room (SPEC 9.5).
  for (const id of ids) {
    const prev = prevPos(id);
    if (!prev || locks.has(id)) continue;
    const [low, up] = affected.has(id) ? ["prevAffected", "prevAffectedUp"] as const : ["prev", "prevUp"] as const;
    for (const [v, c] of [[vx(id), prev.at[0]], [vy(id), prev.at[1]]] as const) {
      cons.push({ a: v, b: X0, c, priority: low, why: `previous ${id}` });
      cons.push({ a: X0, b: v, c: -c, priority: up, why: `previous ${id}` });
    }
  }
  const place = opts.place;
  if (place) {
    const missing = ids.filter((id) => !place[id]);
    if (missing.length) return { status: "invalid_input", pinDefs: defs, issues: [`placement must cover every part; missing ${missing.join(", ")}`], notes };
    cons.length = 0;
    for (const id of ids) cons.push(...eq(vx(id), X0, place[id]!.at[0], "lock", `lock ${id}`), ...eq(vy(id), X0, place[id]!.at[1], "lock", `lock ${id}`));
  }
  let sol = solveWithDrops(vars, cons, 50 + 2 * ids.length);
  if (!sol.ok && fanStart.size) return withoutStagger("placement constraints");
  if (!sol.ok && regions.length) return retry(`templates dropped: placement constraints conflict (${sol.cycle.map((k) => k.why).join("; ")})`, { ...opts, templates: false });
  if (rigid.size && (!sol.ok || sol.dropped.some((k) => k.why.startsWith("stack ")))) return withoutStacks("placement constraints");
  if (childOffsets.size && (!sol.ok || sol.dropped.some((k) => k.why.startsWith("decoupling ")))) return withoutDecoupling("placement constraints");
  if (!sol.ok) return { status: sol.reason, pinDefs: defs, issues: [`placement constraints conflict: ${sol.cycle.map((k) => k.why).join("; ")}`], notes };
  for (const why of [...new Set(sol.dropped.filter((k) => k.why.startsWith("hint ")).map((k) => k.why))]) notes.push(`dropped ${why} (it conflicts with stronger constraints; use priority high to keep it)`);
  const dropped = new Set(sol.dropped);
  const active = cons.filter((k) => !dropped.has(k));

  // Straight-wire pass: try to line up horizontal pins of the same net, one equality at a time.
  const candidates: Array<{ k: Constraint[]; order: [number, string] }> = [];
  for (const n of [...wired].sort((a, b) => cmpStr(netKey(a, vc), netKey(b, vc)))) {
    const ps = [...drawnNet.entries()].filter(([, nn]) => nn === n.id).map(([t]) => t).sort(cmpStr);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const [pa, pb] = [pinInfo(ps[i]!, placed), pinInfo(ps[j]!, placed)];
      if (pa.part === pb.part) continue;
      // Template member pins wired by the template's own runs are not lined up with outside parts.
      const inner = (t: string, part: string) => regionOf.has(part) && !isBoundary(regionOf.get(part)!, part, t.slice(part.length + 1, -1));
      if (inner(ps[i]!, pa.part) || inner(ps[j]!, pb.part)) continue;
      const ca = colOf.get(pa.part)!, cb = colOf.get(pb.part)!;
      if (ca === cb) continue;
      const tag = `${netKey(n, vc)}|${ps[i]}|${ps[j]}`;
      if (isHorizontal(pa.dir) && isHorizontal(pb.dir)) {
        candidates.push({ k: eq(vy(pb.part), vy(pa.part), pa.at[1] - pb.at[1], "align", `straight ${ps[i]}-${ps[j]}`), order: [Math.abs(ca - cb), tag] });
      } else if (isHorizontal(pa.dir) !== isHorizontal(pb.dir)) {
        // One bend: the sideways pin's row sits 2 G beyond the up/down pin, on the side it faces.
        const [h, vv] = isHorizontal(pa.dir) ? [pa, pb] : [pb, pa];
        const off = vv.dir === "up" ? -2 : 2;
        candidates.push({ k: eq(vy(h.part), vy(vv.part), vv.at[1] + off - h.at[1], "align", `corner ${ps[i]}-${ps[j]}`), order: [Math.abs(ca - cb) + 0.5, tag] });
      } else if (pa.dir === pb.dir && (placed.get(pa.part)!.sym.kind === "transistor" || placed.get(pb.part)!.sym.kind === "transistor")) {
        // Two pins facing the same vertical direction in different columns (e.g. a pull-up and a
        // transistor source on one bus): level their tips so one horizontal wire connects them.
        candidates.push({ k: eq(vy(pb.part), vy(pa.part), pa.at[1] - pb.at[1], "align", `level ${ps[i]}-${ps[j]}`), order: [Math.abs(ca - cb) + 1, tag] });
      }
    }
  }
  candidates.sort((a, b) => a.order[0] - b.order[0] || cmpStr(a.order[1], b.order[1]));
  const kept: Constraint[] = [];
  for (const cand of candidates) {
    const trial = solveWithDrops(vars, [...active, ...kept, ...cand.k], 0);
    if (trial.ok) { kept.push(...cand.k); sol = trial; }
  }
  const pos = sol.value;

  // Absolute geometry.
  const at = (id: string): Pt => [pos.get(vx(id))!, pos.get(vy(id))!];
  const obstacles: Obstacle[] = [];
  const el: Electrical = { pins: [], keepouts: [], wires: [], dots: [], ports: [], ncMarks: [] };
  const art: Art[] = [];
  for (const id of ids) {
    const P = placed.get(id)!;
    const o = at(id);
    const ko = shift(P.ko, o);
    obstacles.push({ ...ko, owner: id });
    el.keepouts!.push({ ...ko, part: id });
    for (const p of P.pins) {
      const drawnPin: DrawnPin = { part: id, number: p.number, at: [o[0] + p.at[0], o[1] + p.at[1]], dir: p.dir };
      el.pins.push(drawnPin);
      if (ncSet.has(`${id}[${p.number}]`)) el.ncMarks.push({ part: id, number: p.number });
    }
    for (const l of P.labels) {
      const b = shift(l.box, o);
      const ob = obstacleFromLabel(b, `label:${id}`);
      obstacles.push(ob);
      el.keepouts!.push({ ...ob, part: ob.owner });
    }
    for (const q of P.ports) {
      const b = shift(q.box, o);
      obstacles.push({ ...b, owner: `port:${id}[${q.pin}]` });
      el.keepouts!.push({ ...b, part: `port:${id}[${q.pin}]` });
      const port: DrawnPort = { at: [o[0] + q.anchor[0], o[1] + q.anchor[1]], text: q.net.name!, domain: q.net.domain ?? null, kind: q.kind };
      el.ports.push(port);
    }
  }

  // Template runs (bus trunks, node columns) are pre-routed, unless they would cut through a part,
  // a label, a port symbol or another net's pin or approach point (an edit may have moved things).
  const tplRuns = new Map<string, Pt[][]>();
  const anchors = new Map(el.pins.map((p) => [key(p.at), drawnNet.get(`${p.part}[${p.number}]`)]));
  const approaches = new Map(el.pins.map((p) => [key(step(p.at, p.dir)), drawnNet.get(`${p.part}[${p.number}]`)]));
  for (const r of regions) for (const [netId, runs] of trunkRuns(r, geo, at, interior.get(r))) for (const run of runs) {
    const edges = unitEdges(run);
    const blocked = edges.some(([a, b]) => edgeForbidden(a, b, obstacles)) || edges.flat().some((p) => {
      const k = key(p);
      return anchors.has(k) || (approaches.has(k) && approaches.get(k) !== netId);
    });
    if (blocked) notes.push(`template ${r.template.id}: run on net ${netId} left to the router (blocked)`);
    else tplRuns.set(netId, [...(tplRuns.get(netId) ?? []), run]);
  }

  // Step 7: route wired nets; port stubs are pre-wired.
  const requests: NetRequest[] = [];
  for (const n of circuit.nets) {
    const terms = [...drawnNet.entries()].filter(([, nn]) => nn === n.id).map(([t]) => {
      const p = el.pins.find((q) => `${q.part}[${q.number}]` === t)!;
      return { id: t, at: p.at, dir: p.dir };
    });
    // Start from a horizontal terminal when present so multi-pin nets establish their straight
    // horizontal trunk row before vertical taps join it (avoids U-loops around tap corners).
    const horizFirst = terms.length >= 3 && terms.some((t) => isHorizontal(t.dir)) && terms.some((t) => !isHorizontal(t.dir));
    terms.sort((a, b) => (horizFirst ? Number(!isHorizontal(a.dir)) - Number(!isHorizontal(b.dir)) : 0)
      || colOf.get(partOfTerm(a.id))! - colOf.get(partOfTerm(b.id))! || cmpStr(a.id, b.id));
    if (portNet.has(n.id)) {
      const prewired: Array<[Pt, Pt]> = [];
      for (const id of ids) for (const q of placed.get(id)!.ports) if (q.net.id === n.id && q.stub.length) {
        const o = at(id);
        const s = q.stub.map((p): Pt => [o[0] + p[0], o[1] + p[1]]);
        prewired.push(...unitEdges(s));
      }
      for (const w of childWires.get(n.id) ?? []) {
        const o = at(w.host);
        prewired.push(...unitEdges(w.run.map((p): Pt => [o[0] + p[0], o[1] + p[1]])));
      }
      requests.push({ net: n.id, terminals: terms, prewired: [...new Map(prewired.map((e) => [edgeKey(...e), e])).values()], noRoute: true });
    } else if (opts.previous && opts.reuseRoutes !== false && opts.previous.routes[n.id]?.terminals === signature(terms)) {
      // Incremental mode: a net whose drawn terminals did not move keeps its route.
      requests.push({ net: n.id, terminals: terms, prewired: opts.previous.routes[n.id]!.runs.flatMap((w) => unitEdges(w)), noRoute: true });
    } else {
      const pre = [...(opts.prewire?.[n.id] ?? []), ...(tplRuns.get(n.id) ?? [])];
      requests.push({ net: n.id, terminals: terms, ...(pre.length ? { prewired: pre.flatMap((w) => unitEdges(w)) } : {}) });
    }
  }
  // Net order: template-internal nets first, then fewest endpoints, then canonical key (SPEC 9.2 step 7).
  requests.sort((a, b) => Number(!a.noRoute) - Number(!b.noRoute) || Number(!inRegion(a.net)) - Number(!inRegion(b.net))
    || a.terminals.length - b.terminals.length || cmpStr(netKey(netById.get(a.net)!, vc), netKey(netById.get(b.net)!, vc)));
  // Sheet bounds start from the first part, not from the origin (an origin start left a blank band).
  let bounds: Box = shift(placed.get(ids[0]!)!.env, at(ids[0]!));
  for (const id of ids) bounds = unionBox(bounds, shift(placed.get(id)!.env, at(id)));
  const routeBounds = { x: bounds.x - 4, y: bounds.y - 4, w: bounds.w + 8, h: bounds.h + 8 };
  const routed = route(requests, obstacles, routeBounds);
  // Routing priority may change when incremental mode reuses a tree. Serialize nets
  // canonically so reusing identical wires does not change SVG bytes or layout tokens.
  routed.sort((a, b) => cmpStr(netKey(netById.get(a.net)!, vc), netKey(netById.get(b.net)!, vc)));
  const failed = routed.flatMap((r) => r.failed.map((f) => `${f} (net ${r.net})`));
  if (failed.length && fanStart.size) return withoutStagger(`routing failed for ${failed.join(", ")}`);
  if (failed.length && spacing < 6 && !place) return retry(`routing failed for ${failed.join(", ")}; retrying with spacing +2 G`, { ...opts, spacing: (opts.spacing ?? 0) + 2 });
  // Without templates, as a last resort; in incremental mode the edit first retries with fresh routes.
  const fallback = regions.length > 0 && !(opts.previous && opts.reuseRoutes !== false);
  if (failed.length && fallback) return retry(`routing failed for ${failed.join(", ")}; retrying without templates`, { ...opts, spacing: undefined, templates: false });
  if (failed.length && rigid.size) return withoutStacks(`routing failed for ${failed.join(", ")}`);
  if (failed.length && childOffsets.size) return withoutDecoupling("routing constraints");

  for (const r of routed) {
    el.wires.push(...mergeRuns(r.edges));
    const deg = new Map<string, number>();
    for (const [a, b] of r.edges) for (const p of [a, b]) deg.set(key(p), (deg.get(key(p)) ?? 0) + 1);
    for (const [k, d] of [...deg].sort((x, y) => cmpStr(x[0], y[0]))) if (d >= 3) el.dots.push(k.split(",").map(Number) as unknown as Pt);
    for (const [a, b] of r.edges) bounds = unionBox(bounds, { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) });
  }

  // Artwork.
  for (const id of ids) {
    const P = placed.get(id)!;
    const o = at(id);
    for (const g of P.sym.graphics) art.push({ t: "path", d: xformPath(g.d, o, P.orient), fill: g.fill ?? "none" });
    if (P.sym.kind === "ic") {
      for (const p of P.pins) {
        const name = defs[id]!.find((d) => d.number === p.number)!.name;
        const a: Pt = [o[0] + p.at[0], o[1] + p.at[1]];
        const inset = 1.5;
        if (p.dir === "left") art.push({ t: "text", x: a[0] + inset, y: a[1], text: name, size: PIN_SIZE, anchor: "start", baseline: "middle", owner: `pin:${id}[${p.number}]` });
        else if (p.dir === "right") art.push({ t: "text", x: a[0] - inset, y: a[1], text: name, size: PIN_SIZE, anchor: "end", baseline: "middle", owner: `pin:${id}[${p.number}]` });
        else if (p.dir === "up") art.push({ t: "text", x: a[0], y: a[1] + inset, text: name, size: PIN_SIZE, anchor: "middle", baseline: "top", owner: `pin:${id}[${p.number}]` });
        else art.push({ t: "text", x: a[0], y: a[1] - inset, text: name, size: PIN_SIZE, anchor: "middle", baseline: "bottom", owner: `pin:${id}[${p.number}]` });
      }
    }
    // Fixed symbol text (terminal numbers, header pin names): upright, centred on its transformed point.
    for (const t of P.sym.texts ?? []) {
      const c = xformPt(t.at, o, P.orient);
      art.push({ t: "text", x: c[0], y: c[1], text: t.text, size: t.size, anchor: "middle", baseline: "middle", owner: `pin:${id}[${t.pin}]` });
    }
    for (const l of P.labels) {
      const b = shift(l.box, o);
      l.lines.forEach((line, i) => {
        const x = l.align === "start" ? b.x : l.align === "end" ? b.x + b.w : b.x + b.w / 2;
        art.push({ t: "text", x, y: b.y + i * LINE, text: line, size: LABEL_SIZE, anchor: l.align, baseline: "top", owner: `label:${id}` });
      });
    }
    for (const q of P.ports) {
      const a: Pt = [o[0] + q.anchor[0], o[1] + q.anchor[1]];
      const sym = BUILTIN[q.kind === "ground" ? "ground" : "supply"]!;
      const negative = railLevel(q.net) === -1;
      for (const g of sym.graphics) art.push({ t: "path", d: xformPath(g.d, a, { rot: negative ? 180 : 0, flip: false }), fill: "none" });
      const text = portText(q.kind, q.net);
      if (text) {
        if (q.kind === "power") art.push({ t: "text", x: a[0], y: a[1] + (negative ? 1.3 : -1.3), text, size: LABEL_SIZE, anchor: "middle", baseline: negative ? "top" : "bottom", owner: `port:${id}[${q.pin}]` });
        else art.push({ t: "text", x: a[0] + 1.4, y: a[1] + 1.4, text, size: LABEL_SIZE, anchor: "start", baseline: "middle", owner: `port:${id}[${q.pin}]` });
      }
    }
    for (const p of P.pins) if (ncSet.has(`${id}[${p.number}]`)) {
      const [x, y] = [o[0] + p.at[0], o[1] + p.at[1]];
      art.push({ t: "path", d: `M${(x - 0.4) * 10} ${(y - 0.4) * 10} L${(x + 0.4) * 10} ${(y + 0.4) * 10} M${(x - 0.4) * 10} ${(y + 0.4) * 10} L${(x + 0.4) * 10} ${(y - 0.4) * 10}` });
    }
  }
  for (const r of routed) for (const w of mergeRuns(r.edges)) art.push({ t: "path", d: w.map((p, i) => `${i ? "L" : "M"}${p[0] * 10} ${p[1] * 10}`).join(" ") });
  for (const d of el.dots) art.push({ t: "path", d: circle(d[0] * 10, d[1] * 10, 3.5), fill: "stroke" });

  const sheet = { x: bounds.x - MARGIN, y: bounds.y - MARGIN, w: bounds.w + 2 * MARGIN, h: bounds.h + 2 * MARGIN };
  const render: RenderModel = { electrical: el, art, bounds: sheet, meta: project.meta?.title ? { title: project.meta.title } : {} };
  const lowConfidence = notes.some((n) => n.includes("low confidence"));
  // Step 8: a drawing is valid only if verification layers 1 and 2 pass on the render model.
  if (!failed.length) {
    const q = checkDrawing(circuit, defs, render);
    if (!q.valid && fanStart.size) return withoutStagger("drawing checks");
    if (!q.valid && fallback) return retry(`templates dropped: the drawing failed its checks (${[...q.connections.errors.map((e) => e.message), ...q.overlaps.map((o) => o.message)].join("; ")})`, { ...opts, templates: false });
    if (!q.valid) {
      if (rigid.size) return withoutStacks("the drawing failed its checks");
      if (childOffsets.size) return withoutDecoupling("drawing checks");
      const why = [...q.connections.errors.map((e) => e.message), ...q.overlaps.map((o) => o.message)];
      return { status: "budget_exhausted", render, pinDefs: defs, issues: why.map((w) => `check: ${w}`), notes, state: stateOf() };
    }
  }
  const blocks = reps.map((b) => ({ id: regionOf.has(b) ? `${regionOf.get(b)!.template.id}:${b}` : b, parts: membersOf(b), rank: rank.get(b)!,
    ...(regionOf.has(b) ? { template: regionOf.get(b)!.key, links: regionOf.get(b)!.links } : {}) }));
  const result: LayoutResult = { status: failed.length ? "budget_exhausted" : lowConfidence ? "valid_low_confidence" : "valid", render, pinDefs: defs, issues: failed.map((f) => `could not route ${f}`), notes, state: stateOf(), blocks };
  // Pin order: on the left and right of a generated IC box, the pins follow the height of what they
  // connect to; on a free op-amp, IN+ and IN- follow the height of what they connect to (keeping
  // OUT facing right). The first layout shows where that is; a second layout with that order is
  // kept only if it has fewer crossings, then fewer bends, then less wire.
  if (!failed.length && !opts.previous && !place && !opts.pinOrder && !opts.opampOrient) {
    const want: NonNullable<LayoutOptions["pinOrder"]> = {};
    const wantOpamp: Record<string, Orient> = {};
    const pinHeight = (id: string, num: string, o: Pt): number | undefined => {
      const net = drawnNet.get(`${id}[${num}]`);
      if (net === undefined) return undefined;
      if (portNet.has(net)) {
        const lvl = railLevel(netById.get(net)!);
        return lvl === 1 ? o[1] - 100 : lvl === 0 || lvl === -1 ? o[1] + 100 : undefined;
      }
      const others = el.pins.filter((q) => q.part !== id && drawnNet.get(`${q.part}[${q.number}]`) === net);
      return others.length ? others.reduce((sum, q) => sum + q.at[1], 0) / others.length : undefined;
    };
    for (const id of ids) {
      const P = placed.get(id)!;
      if (regionOf.has(id) || linkOf.has(id)) continue;
      const o = at(id);
      if (P.sym.kind === "ic" && !sidesHint.has(id)) {
        for (const side of ["left", "right"] as const) {
          const now = P.pins.filter((q) => q.dir === side).sort((a, b) => a.at[1] - b.at[1]).map((q, i) => ({ n: q.number, y: pinHeight(id, q.number, o) ?? o[1] + q.at[1], i }));
          const sorted = [...now].sort((a, b) => a.y - b.y || a.i - b.i);
          if (sorted.some((k, i) => k.n !== now[i]!.n)) (want[id] ??= {})[side] = sorted.map((k) => k.n);
        }
      } else if (partOf.get(id)!.type === "opamp" && !locks.has(id) && !orientHint.has(id)) {
        const inMinus = P.pins.find((q) => q.number === "2"), inPlus = P.pins.find((q) => q.number === "3");
        if (!inMinus || !inPlus || inMinus.dir !== "left" || inPlus.dir !== "left") continue;
        const ym = pinHeight(id, "2", o), yp = pinHeight(id, "3", o);
        if (ym === undefined || yp === undefined || ym === yp) continue;
        const plusOnTop = yp < ym;
        const isPlusOnTop = inPlus.at[1] < inMinus.at[1];
        if (plusOnTop !== isPlusOnTop) wantOpamp[id] = plusOnTop ? { rot: 180, flip: true } : { rot: 0, flip: false };
      }
    }
    if (Object.keys(want).length || Object.keys(wantOpamp).length) {
      const again = layout(project, {
        ...opts,
        ...(Object.keys(want).length ? { pinOrder: want } : {}),
        ...(Object.keys(wantOpamp).length ? { opampOrient: wantOpamp } : {}),
      });
      if (again.status === result.status && again.render) {
        const a = checkDrawing(circuit, defs, render).metrics, b = checkDrawing(circuit, again.pinDefs, again.render).metrics;
        if (b.crossings < a.crossings || (b.crossings === a.crossings && (b.bends < a.bends || (b.bends === a.bends && b.wireLength < a.wireLength)))) {
          if (Object.keys(want).length) again.notes.push(`pin order: ${Object.keys(want).sort(cmpStr).join(", ")} drawn with pins in the order of their connections`);
          if (Object.keys(wantOpamp).length) again.notes.push(`opamp orient: ${Object.keys(wantOpamp).sort(cmpStr).join(", ")} flipped vertically to match input heights`);
          return again;
        }
      }
    }
  }
  return result;

  /** Lay out again with other options, keeping this attempt's notes first. */
  function retry(why: string, next: LayoutOptions): LayoutResult {
    notes.push(why);
    const again = layout(project, next);
    again.notes.unshift(...notes);
    return again;
  }

  function stateOf(): LayoutState {
  const state: LayoutState = { parts: {}, routes: {} };
  for (const id of ids) {
    const P = placed.get(id)!;
    const entry: LayoutState["parts"][string] = { at: at(id), orient: P.orient, column: colValue.get(id)! };
    if (P.sym.kind === "ic") {
      const side = (d: Dir): Side => (d === "left" ? "left" : d === "right" ? "right" : d === "up" ? "top" : "bottom");
      const sides: Partial<Record<Side, string[]>> = {};
      for (const p of [...P.sym.pins].sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0])) (sides[side(p.dir)] ??= []).push(p.number);
      entry.sides = sides;
    }
    state.parts[id] = entry;
  }
  for (const r of routed) {
    const req = requests.find((q) => q.net === r.net)!;
    state.routes[r.net] = { terminals: signature(req.terminals), runs: mergeRuns(r.edges), ...(portNet.has(r.net) ? { ports: true as const } : {}) };
  }
  if (regions.length) state.templates = regions.map((r) => r.key).sort(cmpStr);
  return state;
  }
}

// ---------------------------------------------------------------------------

/** Drawn terminals of a net with positions and directions; equal signatures mean the same pins in the same places. */
function signature(terms: readonly { id: string; at: Pt; dir: Dir }[]): string {
  return terms.map((t) => `${t.id}@${t.at[0]},${t.at[1]},${t.dir}`).sort(cmpStr).join(";");
}

function partOfTerm(t: string): string { return t.slice(0, t.indexOf("[")); }

/** Canonical key of a net: its smallest canonical endpoint (SPEC 9.6). Never the storage id. */
function netKey(n: Net, vc: ValidCircuit): string {
  return vc.endpoints.get(n.id)!.map(canonical).sort(cmpStr)[0] ?? "";
}

function pinInfo(t: string, placed: Map<string, Placed>) {
  const part = partOfTerm(t), num = t.slice(part.length + 1, -1);
  const p = placed.get(part)!.pins.find((q) => q.number === num)!;
  return { part, number: num, at: p.at, dir: p.dir };
}

function shift(b: Box, o: Pt): Box { return { x: b.x + o[0], y: b.y + o[1], w: b.w, h: b.h }; }

/** SPEC 9.2 step 3b for two-pin parts. */
function twoPinOrient(
  sym: SymbolDef, id: string, drawnNet: Map<string, string>, netById: Map<string, Net>, portNet: Set<string>,
  col: number, netCol: (net: string, self: string) => number | undefined,
): Orient {
  const [p1, p2] = sym.pins as [SymbolDef["pins"][0], SymbolDef["pins"][0]];
  const n1 = drawnNet.get(`${id}[${p1.number}]`), n2 = drawnNet.get(`${id}[${p2.number}]`);
  // Pin 1 is at the local left (dir left), pin 2 at the right. rot 90: pin1 up; rot 270: pin1 down.
  const lower = lowerRailEnd(netById.get(n1 ?? ""), netById.get(n2 ?? ""), portNet);
  if (lower) return { rot: lower === 2 ? 90 : 270, flip: false };
  const c1 = n1 ? netCol(n1, id) : undefined, c2 = n2 ? netCol(n2, id) : undefined;
  // A two-pin part whose both ends connect within its own column bridges vertically stacked blocks.
  if (c1 !== undefined && c2 !== undefined && c1 === col && c2 === col) return { rot: 90, flip: false };
  if (c1 !== undefined && c2 !== undefined && c2 < c1) return { rot: 180, flip: false };
  return { rot: 0, flip: false };
}

/** Generated IC box with pin sides from roles and flow (SPEC 7.3); only drawn pins appear. */
function icFor(
  id: string, pins: PinDef[], drawnNet: Map<string, string>, netById: Map<string, Net>, ncSet: Set<string>, col: number,
  netCol: (net: string, self: string) => number | undefined,
  forced?: Partial<Record<Side, string[]>>,
  after?: Partial<Record<Side, string[]>>,
  slotRoom?: ReadonlyMap<string, number>,
): SymbolDef {
  const visible = pins.filter((p) => drawnNet.has(`${id}[${p.number}]`) || ncSet.has(`${id}[${p.number}]`));
  const sides = { left: [] as PinDef[], right: [] as PinDef[], top: [] as PinDef[], bottom: [] as PinDef[] };
  for (const p of visible) {
    const netId = drawnNet.get(`${id}[${p.number}]`);
    const level = netId ? railLevel(netById.get(netId)!) : undefined;
    if ([...Object.values(forced ?? {}), ...Object.values(after ?? {})].some((ns) => ns.includes(p.number))) continue;
    if (p.role === "ground" || level === 0 || level === -1) sides.bottom.push(p);
    else if (p.role === "power_in" || level === 1) sides.top.push(p);
    else {
      const c = netId ? netCol(netId, id) : undefined;
      (c !== undefined && c < col ? sides.left : sides.right).push(p);
    }
  }
  const sortKey = (p: PinDef) => { const n = drawnNet.get(`${id}[${p.number}]`); const net = n ? netById.get(n) : undefined; return net?.name ?? `~${p.number}`; };
  for (const s of Object.values(sides)) s.sort((a, b) => cmpStr(sortKey(a), sortKey(b)) || cmpNatural(a.number, b.number));
  // Forced sides (SPEC 11.3 setPinSides): listed pins first, in the given order; a template's, last.
  const listed = (ns: string[]) => ns.map((n) => visible.find((p) => p.number === n)).filter((p): p is PinDef => p !== undefined);
  for (const [side, ns] of Object.entries(forced ?? {}) as Array<[Side, string[]]>) sides[side].unshift(...listed(ns));
  for (const [side, ns] of Object.entries(after ?? {}) as Array<[Side, string[]]>) sides[side].push(...listed(ns));
  const textW = (ps: PinDef[]) => Math.max(0, ...ps.map((p) => measure(p.name, PIN_SIZE).width / 10));
  const inner = Math.ceil(textW(sides.left) + textW(sides.right) + 3);
  const pitch = Math.max(2, Math.ceil(textW([...sides.top, ...sides.bottom]) + 1));
  // A decoupled supply pin keeps its child slots' room from a neighbour that has none of its own.
  const room = (p: PinDef) => slotRoom?.get(p.number);
  const topGap = (a: PinDef, b: PinDef) => (room(a) === undefined) === (room(b) === undefined) ? 0 : room(a) ?? room(b)!;
  return icSymbol(sides, inner, pitch, topGap);
}

function portText(kind: "ground" | "power", net: Net): string | undefined {
  if (kind === "ground" && net.name === "GND" && !net.domain) return undefined; // default ground: symbol only
  return net.domain ? `${net.name} (${net.domain})` : net.name;
}

function portBox(kind: "ground" | "power", net: Net, a: Pt): Box {
  const text = portText(kind, net);
  const tw = text ? measure(text, LABEL_SIZE).width / 10 : 0;
  if (kind === "ground") {
    const b: Box = { x: a[0] - 1, y: a[1], w: 2, h: 2 };
    return text ? gridBox(unionBox(b, { x: a[0] + 1.4, y: a[1] + 0.6, w: tw, h: 1.6 })) : b;
  }
  const negative = railLevel(net) === -1;
  return gridBox(unionBox({ x: a[0] - 1, y: a[1] + (negative ? 0 : -1), w: 2, h: 1 }, { x: a[0] - tw / 2, y: a[1] + (negative ? 1.3 : -2.9), w: tw, h: 1.6 }));
}

function displayValue(type: string, raw: string): string {
  const unit = quantityOf(type, "value");
  if (!unit) return raw;
  const q = parseQuantity(raw, unit);
  if (!q.ok) return raw;
  const sym = { ohm: "Ω", farad: "F", henry: "H", volt: "V", amp: "A", hertz: "Hz" }[unit];
  const pre: Array<[number, string]> = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
  const [mult, p] = pre.find(([m]) => Math.abs(q.value) >= m * 0.999) ?? [1e-12, "p"];
  const n = Number((q.value / mult).toPrecision(3));
  return `${n} ${p}${sym}`;
}

const WRAP_IC_LABEL_AT = 16; // G; wrap long IC/module titles so one banner does not widen a whole column
const WRAP_IC_LABEL_W = 11;  // G; target line width once wrapping triggers

function wrapLine(text: string, triggerW: number, maxW: number): string[] {
  const width = (s: string) => measure(s, LABEL_SIZE).width / 10;
  if (width(text) <= triggerW) return [text];
  const words = text.trim().split(/\s+/);
  if (words.length <= 1) return [text];
  // Balance lines across the minimum line count that fits within maxW (greedily with balanced target).
  const greedy = (limit: number): string[] => {
    const out: string[] = [];
    let cur = words[0]!;
    for (let i = 1; i < words.length; i++) {
      const next = `${cur} ${words[i]}`;
      if (width(next) <= limit) cur = next;
      else { out.push(cur); cur = words[i]!; }
    }
    out.push(cur);
    return out;
  };
  const base = greedy(maxW);
  const target = Math.min(maxW, Math.max(width(text) / base.length * 1.15, Math.max(...words.map(width))));
  const balanced = greedy(target);
  return balanced.length <= base.length ? balanced : base;
}

function labelLines(part: Circuit["parts"][0], sym: SymbolDef): string[] {
  const lines = [part.id];
  const value = part.props?.value ?? part.props?.label ?? part.props?.color ?? part.props?.partNumber ?? part.title;
  if (value) {
    if (sym.kind === "ic") lines.push(...wrapLine(value, WRAP_IC_LABEL_AT, WRAP_IC_LABEL_W));
    else lines.push(displayValue(part.type, value));
  }
  return lines;
}

function labelFor(part: Circuit["parts"][0], sym: SymbolDef, o: Orient, ko: Box, avoid: Box[], side?: string, freeSide = false, belowPrefer?: "below-left" | "below-right"): Placed["labels"] {
  if (sym.kind === "port") return [];
  const lines = labelLines(part, sym);
  const w = Math.max(...lines.map((l) => measure(l, LABEL_SIZE).width / 10));
  const h = lines.length * LINE;
  const vertical = (sym.kind === "two-pin" || sym.kind === "source") && (o.rot === 90 || o.rot === 270);
  const wrappedIc = sym.kind === "ic" && lines.length > 2;
  const hasRightPin = sym.pins.some((p) => xformDir(p.dir, o) === "right");
  const prefer = sym.kind === "ic"
    ? (belowPrefer === "below-right"
      ? ["below-left", "below-right", "below-right-out", "below-left-out", "right", "left", "above-left", "above-right", "above-left-out", "above-right-out"]
      : belowPrefer === "below-left"
        ? ["below-left", "below-right", "below-left-out", "below-right-out", "left", "right", "above-left", "above-right", "above-left-out", "above-right-out"]
        : freeSide && wrappedIc && !hasRightPin
          ? ["right", "above-right", "above-left", "below-right", "below-left", "above-right-out", "below-right-out", "above-left-out", "below-left-out", "left"]
          : ["above-left", "above-right", "below-left", "below-right", "above-left-out", "above-right-out", "below-left-out", "below-right-out", "left", "right"])
    : vertical ? (sym.kind === "source" ? ["left", "right"] : ["right", "left"]) : sym.labelPrefer;
  const order = side ? [side, ...prefer.filter((x) => x !== side)] : prefer; // label-side override first (SPEC 6.4)
  const gap = 0.4;
  const cands: Record<string, { box: Box; align: "start" | "middle" | "end" }> = {
    above: { box: { x: ko.x + ko.w / 2 - w / 2, y: ko.y - gap - h, w, h }, align: "middle" },
    below: { box: { x: ko.x + ko.w / 2 - w / 2, y: ko.y + ko.h + gap, w, h }, align: "middle" },
    right: { box: { x: ko.x + ko.w + gap, y: ko.y + ko.h / 2 - h / 2, w, h }, align: "start" },
    left: { box: { x: ko.x - gap - w, y: ko.y + ko.h / 2 - h / 2, w, h }, align: "end" },
    "above-left": { box: { x: ko.x + 1, y: ko.y - gap - h, w, h }, align: "start" },
    "above-right": { box: { x: ko.x + ko.w - 1 - w, y: ko.y - gap - h, w, h }, align: "end" },
    "below-left": { box: { x: ko.x + 1, y: ko.y + ko.h + gap, w, h }, align: "start" },
    "below-right": { box: { x: ko.x + ko.w - 1 - w, y: ko.y + ko.h + gap, w, h }, align: "end" },
    "above-left-out": { box: { x: ko.x + 1 - w, y: ko.y - gap - h, w, h }, align: "end" },
    "above-right-out": { box: { x: ko.x + ko.w - 1, y: ko.y - gap - h, w, h }, align: "start" },
    "below-left-out": { box: { x: ko.x + 1 - w, y: ko.y + ko.h + gap, w, h }, align: "end" },
    "below-right-out": { box: { x: ko.x + ko.w - 1, y: ko.y + ko.h + gap, w, h }, align: "start" },
  };
  for (const pick of order) {
    const c = cands[pick]!;
    if (!avoid.some((b) => boxesOverlap(gridBox(c.box), b))) return [{ box: c.box, lines, align: c.align }];
  }
  const c = cands[order[0]!]!;
  return [{ box: c.box, lines, align: c.align }];
}

/** Merge unit edges of one net into maximal straight runs (for drawing only). */
function mergeRuns(edges: Array<[Pt, Pt]>): Pt[][] {
  const set = new Set(edges.map(([a, b]) => edgeKey(a, b)));
  const done = new Set<string>();
  const runs: Pt[][] = [];
  const parse = (k: string) => k.split("|").map((s) => s.split(",").map(Number)) as unknown as [Pt, Pt];
  for (const k of [...set].sort(cmpStr)) {
    if (done.has(k)) continue;
    const [a, b] = parse(k);
    const horiz = a[1] === b[1];
    const d: Dir = horiz ? "right" : "down";
    const back: Dir = horiz ? "left" : "up";
    let s = a, e = b;
    done.add(k);
    for (;;) { const n = step(s, back); const nk = edgeKey(n, s); if (!set.has(nk) || done.has(nk)) break; done.add(nk); s = n; }
    for (;;) { const n = step(e, d); const nk = edgeKey(e, n); if (!set.has(nk) || done.has(nk)) break; done.add(nk); e = n; }
    runs.push([s, e]);
  }
  return runs;
}

function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
}

/** Transform symbol path data (M L H V A Z, absolute, local grid units) to sheet SVG units. */
export function xformPath(d: string, at: Pt, o: Orient): string {
  const tok = d.match(/[MLHVAZ]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let i = 0, cur: Pt = [0, 0];
  const num = () => Number(tok[i++]);
  const P = (p: Pt) => { const q = xformPt(p, at, o); return `${r2(q[0] * 10)} ${r2(q[1] * 10)}`; };
  const out: string[] = [];
  let cmd = "";
  while (i < tok.length) {
    if (/[MLHVAZ]/.test(tok[i]!)) cmd = tok[i++]!;
    switch (cmd) {
      case "M": case "L": cur = [num(), num()]; out.push(`${cmd}${P(cur)}`); break;
      case "H": cur = [num(), cur[1]]; out.push(`L${P(cur)}`); break;
      case "V": cur = [cur[0], num()]; out.push(`L${P(cur)}`); break;
      case "A": {
        const rx = num(), ry = num(), rotA = num(), large = num(), sweep = num();
        cur = [num(), num()];
        const [rxx, ryy] = o.rot === 90 || o.rot === 270 ? [ry, rx] : [rx, ry];
        out.push(`A${r2(rxx * 10)} ${r2(ryy * 10)} ${rotA} ${large} ${o.flip ? 1 - sweep : sweep} ${P(cur)}`);
        break;
      }
      case "Z": out.push("Z"); break;
      default: i++;
    }
  }
  return out.join(" ");
}

function r2(n: number): string { const v = Math.round(n * 100) / 100; return String(Object.is(v, -0) ? 0 : v); }

