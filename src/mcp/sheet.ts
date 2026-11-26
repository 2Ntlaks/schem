// Turn a loaded project into the small JSON an MCP tool returns (SPEC 11.1, 11.5).
// Layout, verification and findings stay in the engine. This file only calls them.

import type { LayoutState } from "../core/intent.js";
import { netKind, type PinDefs } from "../core/model.js";
import { classOf, validate } from "../core/validate.js";
import { layoutToken, revision } from "../edit/edit.js";
import { review, type ReviewFinding } from "../edit/findings.js";
import { fromLayoutCache, toLayoutCache } from "../io/layout-cache.js";
import { loadProject, projectPinDefs, saveProject, type LoadedProject } from "../io/project.js";
import { layout, type LayoutResult } from "../layout/layout.js";
import { checkDrawing, type DrawingCheck } from "../quality/index.js";
import { textBlocks } from "../quality/drawing.js";
import type { Box, Pt } from "../geom/geom.js";
import type { RenderModel } from "../render/model.js";
import { toPng } from "../render/png.js";
import { toSvg, type SvgOptions } from "../render/svg.js";

export const MAX_FILE = 2 * 1024 * 1024;
export const MAX_PARTS = 500;
export const MAX_PINS = 512;
export const MAX_LABEL = 200;
export const MAX_PATH_COMMANDS = 5000;
export const MAX_PNG_SIDE = 8000;
export const MAX_PNG_PIXELS = 40_000_000;
export const LABEL_MIN_PX = 9;
export const FINDING_PAGE = 5;
export const QUERY_PAGE = 20;
export const PREVIEW_MAX = 1024;

/** SVG units per grid unit, as toSvg writes the viewBox. */
const SVG_PER_G = 10;
/** Part-label size in SVG units (src/layout/layout.ts LABEL_SIZE), used when a sheet has no label. */
const LABEL_SVG = 12;

export type Detail = "brief" | "normal" | "full";

export function readDetail(v: unknown, fallback: Detail): Detail | undefined {
  if (v === undefined) return fallback;
  if (v === "brief" || v === "normal" || v === "full") return v;
  return undefined;
}

type Obj = Record<string, unknown>;
function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** How many parts the document declares, before the loader checks them. */
export function declaredPartCount(doc: unknown): number | undefined {
  if (!isObj(doc)) return undefined;
  const circuit = doc.circuit;
  if (!isObj(circuit) || !Array.isArray(circuit.parts)) return undefined;
  return circuit.parts.length;
}

/** A pin list already over the limit, so the loader is not asked to check it. */
export function rawPinGuard(doc: unknown): string | undefined {
  if (!isObj(doc) || !isObj(doc.circuit) || !Array.isArray(doc.circuit.parts)) return undefined;
  for (const part of doc.circuit.parts) {
    if (!isObj(part) || !Array.isArray(part.pins) || part.pins.length <= MAX_PINS) continue;
    const id = typeof part.id === "string" ? part.id : "a part";
    return `${id} has ${part.pins.length} pins. The limit is ${MAX_PINS}.`;
  }
  return undefined;
}

/** SPEC 11.2 limits that apply to a project the loader has already accepted. */
export function guardProject(p: LoadedProject): string[] {
  const issues: string[] = [];
  if (p.circuit.parts.length > MAX_PARTS) issues.push(`this circuit has ${p.circuit.parts.length} parts. The limit is ${MAX_PARTS}.`);
  if ((p.meta.title ?? "").length > MAX_LABEL) issues.push(`the title is longer than ${MAX_LABEL} characters.`);
  const defs = projectPinDefs(p);
  for (const part of p.circuit.parts) {
    const pins = defs[part.id] ?? [];
    if (pins.length > MAX_PINS) issues.push(`${part.id} has ${pins.length} pins. The limit is ${MAX_PINS}.`);
    if (part.id.length > MAX_LABEL) issues.push(`a part id is longer than ${MAX_LABEL} characters.`);
    for (const pin of pins) {
      if (pin.name.length > MAX_LABEL) issues.push(`${part.id} pin ${pin.number} has a name longer than ${MAX_LABEL} characters.`);
    }
    for (const [key, value] of Object.entries(part.props ?? {})) {
      if (value.length > MAX_LABEL) issues.push(`${part.id} property ${key} is longer than ${MAX_LABEL} characters.`);
    }
  }
  for (const net of p.circuit.nets) {
    if ((net.name ?? "").length > MAX_LABEL) issues.push(`net ${net.id} has a name longer than ${MAX_LABEL} characters.`);
  }
  for (const [id, def] of Object.entries(p.assets.definitions)) {
    const n = pathCommands(def);
    if (n > MAX_PATH_COMMANDS) issues.push(`symbol ${id} has ${n} path commands. The limit is ${MAX_PATH_COMMANDS}.`);
  }
  return issues;
}

function pathCommands(def: unknown): number {
  let n = 0;
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (!isObj(v)) return;
    for (const [k, child] of Object.entries(v)) {
      if (k === "d" && typeof child === "string") n += (child.match(/[MLHVCSQTAZ]/gi) ?? []).length;
      else walk(child);
    }
  };
  walk(def);
  return n;
}

export interface Drawn {
  result: LayoutResult;
  note?: string;
  check?: DrawingCheck;
}

/** The drawing `schem draw` would show: the saved layout when it still matches, otherwise a fresh one. */
export function drawProject(project: LoadedProject): Drawn {
  const saved = fromLayoutCache(project.layoutCache, revision(project));
  let note = saved.note;
  let result = saved.state ? layout(project, { previous: saved.state, affected: [] }) : layout(project);
  if (saved.state && (result.render === undefined || result.status !== "valid")) {
    note = "the saved layout no longer draws cleanly with this version of schem, so it is drawn afresh.";
    result = layout(project);
  }
  const check = result.render ? checkDrawing(project.circuit, result.pinDefs, result.render) : undefined;
  return { result, ...(note ? { note } : {}), ...(check ? { check } : {}) };
}

/**
 * File text for a project plus the layout it was just drawn with, and the tokens of that file.
 * The revision is taken after a save/load round trip, as `schem edit` does, so the token matches
 * what the next reader computes.
 */
export function commitDrawing(project: LoadedProject, state: LayoutState, mode: string): { text: string; revision: string; layoutToken: string } {
  const { layoutCache: _old, ...rest } = project;
  const draft = loadProject(saveProject(rest));
  if (!draft.ok || draft.project === undefined) {
    throw new Error(draft.errors.map((e) => `${e.code} ${e.message}`).join(" ") || "the project could not be read back.");
  }
  const basis = revision(draft.project);
  const cache = toLayoutCache(state, basis, mode);
  const text = saveProject({ ...rest, layoutCache: cache });
  const back = fromLayoutCache(cache, basis).state;
  if (back === undefined) throw new Error("the layout just written could not be read back.");
  return { text, revision: basis, layoutToken: layoutToken(draft.project, back) };
}

/** Finding ids in the same order and spelling as review() in src/edit/findings.ts. */
export function findingIds(check: DrawingCheck): string[] {
  const ids: string[] = [];
  for (const e of [...check.connections.errors, ...check.overlaps]) ids.push(`E-${e.code}`);
  for (const f of check.conventions) ids.push(f.id);
  for (const b of check.breaches) ids.push(`L-${b.metric}`);
  return ids;
}

export function pageOf<T>(items: readonly T[], cursor: string | undefined, size: number): { ok: true; items: T[]; next: string | null } | { ok: false; message: string } {
  let offset = 0;
  if (cursor !== undefined) {
    if (!/^[0-9]+$/.test(cursor)) return { ok: false, message: "cursor is a decimal offset, such as 0 or 5." };
    offset = Number(cursor);
    if (!Number.isSafeInteger(offset)) return { ok: false, message: "cursor is too large." };
  }
  const next = offset + size < items.length ? String(offset + size) : null;
  return { ok: true, items: items.slice(offset, offset + size), next };
}

/** JSON with non-finite numbers written as null, so a metric of Infinity survives JSON.stringify. */
export function toJson(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "number" && !Number.isFinite(x) ? null : x)) ?? "null");
}

export function sheetPayload(
  project: LoadedProject,
  drawn: Drawn,
  opts: { detail: Detail; cursor?: string; revision?: string; layoutToken?: string; warnings?: string[] },
): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  const r = drawn.result;
  const check = drawn.check;
  const token = opts.layoutToken ?? (r.state ? layoutToken(project, r.state) : undefined);
  const body: Record<string, unknown> = {
    status: r.status,
    verified: check?.valid ?? false,
    revision: opts.revision ?? revision(project),
    ...(token !== undefined ? { layoutToken: token } : {}),
    counts: {
      parts: project.circuit.parts.length,
      nets: project.circuit.nets.length,
      errors: (check?.connections.errors.length ?? 0) + (check?.overlaps.length ?? 0),
      warnings: check?.conventions.length ?? 0,
      notes: check?.breaches.length ?? 0,
    },
  };
  if (drawn.note) body.note = drawn.note;
  if (opts.warnings && opts.warnings.length) body.warnings = opts.warnings;
  if (r.issues.length) body.issues = r.issues;
  if (r.notes.length) body.layoutNotes = r.notes;

  if (opts.detail === "brief" || check === undefined || r.state === undefined || r.render === undefined) return { ok: true, body };
  const reviewed = review(project, r.state, r.render, FINDING_PAGE);
  const page = pageOf(reviewed, opts.cursor, FINDING_PAGE);
  if (!page.ok) return page;
  body.findings = page.items.map(publicFinding);
  body.findingsTotal = reviewed.length;
  body.cursor = page.next;
  if (opts.detail === "full") body.metrics = toJson(check.metrics);
  return { ok: true, body };
}

function publicFinding(f: ReviewFinding): unknown {
  return {
    id: f.id,
    severity: f.severity,
    message: f.message,
    fix: f.fix === null ? null : toJson(f.fix),
  };
}

export function pngSize(buf: Buffer): { width: number; height: number } | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || sig.some((b, i) => buf[i] !== b)) return undefined;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Pixels per grid unit that keep the picture inside the PNG limits. */
export function maxScale(wG: number, hG: number): number {
  const longer = Math.max(wG, hG, 1e-9);
  const bySide = MAX_PNG_SIDE / longer;
  const byArea = Math.sqrt(MAX_PNG_PIXELS / Math.max(wG * hG, 1e-9));
  return Math.floor(Math.min(bySide, byArea) * 1000) / 1000;
}

export function rasterSize(wG: number, hG: number, pxPerGrid: number): { ok: true; pxPerGrid: number; width: number; height: number } | { ok: false; message: string } {
  if (!Number.isFinite(pxPerGrid) || pxPerGrid <= 0) return { ok: false, message: "scale must be a positive number of pixels per grid unit." };
  const width = wG * pxPerGrid;
  const height = hG * pxPerGrid;
  if (width > MAX_PNG_SIDE || height > MAX_PNG_SIDE || width * height > MAX_PNG_PIXELS) {
    return { ok: false, message: `that image would be ${Math.ceil(width)} by ${Math.ceil(height)} px. The limit is ${MAX_PNG_SIDE} px per side and 40 megapixels. The largest scale for this sheet is ${maxScale(wG, hG)}.` };
  }
  return { ok: true, pxPerGrid, width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

export function fitScale(wG: number, hG: number, maxSize: number): ReturnType<typeof rasterSize> {
  const longer = Math.max(wG, hG);
  if (!(longer > 0)) return { ok: false, message: "the drawing has no size." };
  const wanted = rasterSize(wG, hG, maxSize / longer);
  if (wanted.ok) return wanted;
  return rasterSize(wG, hG, maxScale(wG, hG));
}

/** Height of a part label in PNG pixels at this scale. 1 G is 10 SVG units. */
export function labelPixels(render: RenderModel, pxPerGrid: number): number {
  let size = LABEL_SVG;
  let found = false;
  for (const a of render.art) {
    if (a.t !== "text") continue;
    if (a.owner !== undefined && !a.owner.startsWith("label:")) continue;
    if (!found || a.size < size) size = a.size;
    found = true;
  }
  return (size / SVG_PER_G) * pxPerGrid;
}

function owns(owner: string, id: string): boolean {
  return owner === id || owner === `label:${id}` || owner.startsWith(`pin:${id}[`) || owner.startsWith(`port:${id}[`);
}

function union(boxes: Box[]): Box | undefined {
  if (boxes.length === 0) return undefined;
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const b of boxes) {
    x = Math.min(x, b.x);
    y = Math.min(y, b.y);
    right = Math.max(right, b.x + b.w);
    bottom = Math.max(bottom, b.y + b.h);
  }
  return { x, y, w: right - x, h: bottom - y };
}

function clampBox(b: Box, sheet: Box): Box {
  const x = Math.max(b.x, sheet.x);
  const y = Math.max(b.y, sheet.y);
  const right = Math.min(b.x + b.w, sheet.x + sheet.w);
  const bottom = Math.min(b.y + b.h, sheet.y + sheet.h);
  return { x, y, w: Math.max(0.5, right - x), h: Math.max(0.5, bottom - y) };
}

/** A crop around the named parts, their labels and their port symbols, padded by 2 G. */
export function focusBox(render: RenderModel, ids: readonly string[]): Box | undefined {
  const boxes: Box[] = [];
  for (const k of render.electrical.keepouts ?? []) {
    if (ids.some((id) => owns(k.part, id))) boxes.push(k);
  }
  for (const t of textBlocks(render)) {
    if (ids.some((id) => owns(t.owner, id))) boxes.push(t);
  }
  const u = union(boxes);
  if (u === undefined) return undefined;
  return clampBox({ x: u.x - 2, y: u.y - 2, w: u.w + 4, h: u.h + 4 }, render.bounds);
}

export function focusPoints(render: RenderModel, points: readonly Pt[]): Box | undefined {
  const region = union(points.map(([x, y]) => ({ x: x - 2, y: y - 2, w: 4, h: 4 })));
  return region ? clampBox(region, render.bounds) : undefined;
}

/** Same SVG, with the viewBox and the physical size reduced to `crop`. overflow hides the rest. */
export function cropSvg(svg: string, crop: Box): string {
  const fmt = (n: number) => {
    const v = Math.round(n * 100) / 100;
    return String(Object.is(v, -0) ? 0 : v);
  };
  const vb = [crop.x * SVG_PER_G, crop.y * SVG_PER_G, crop.w * SVG_PER_G, crop.h * SVG_PER_G].map(fmt).join(" ");
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(crop.w * 2.54)}mm" height="${fmt(crop.h * 2.54)}mm" viewBox="${vb}" overflow="hidden">`;
  return svg.replace(/^<svg\b[^>]*>/, open);
}

export function renderPng(render: RenderModel, pxPerGrid: number, crop?: Box, svgOpts?: SvgOptions): { ok: true; png: Buffer; width: number; height: number; pxPerGrid: number } | { ok: false; message: string } {
  const box = crop ?? render.bounds;
  const sized = rasterSize(box.w, box.h, pxPerGrid);
  if (!sized.ok) return sized;
  const rawSvg = toSvg(render, svgOpts);
  const svg = crop ? cropSvg(rawSvg, crop) : rawSvg;
  const png = svgOpts?.transparent ? toPng(svg, sized.pxPerGrid, { transparent: true }) : toPng(svg, sized.pxPerGrid);
  const actual = pngSize(png);
  if (actual === undefined) return { ok: false, message: "the PNG renderer did not return a PNG." };
  if (actual.width > MAX_PNG_SIDE || actual.height > MAX_PNG_SIDE || actual.width * actual.height > MAX_PNG_PIXELS) {
    return { ok: false, message: `the PNG is ${actual.width} by ${actual.height} px, over the limit of ${MAX_PNG_SIDE} px per side and 40 megapixels.` };
  }
  return { ok: true, png, width: actual.width, height: actual.height, pxPerGrid: sized.pxPerGrid };
}

export interface QueryArgs {
  part?: string;
  net?: string;
  cursor?: string;
}

/** Positions, pins and connections from the drawing (SPEC 11.5 schem_query). */
export function queryBody(project: LoadedProject, drawn: Drawn, args: QueryArgs): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  const state = drawn.result.state;
  const render = drawn.result.render;
  if (state === undefined || render === undefined) {
    return { ok: false, message: `could not draw this circuit (${drawn.result.status}).` };
  }
  const tokens = {
    status: drawn.result.status,
    verified: drawn.check?.valid ?? false,
    revision: revision(project),
    layoutToken: layoutToken(project, state),
  };
  if (args.part !== undefined) {
    const part = project.circuit.parts.find((p) => p.id === args.part);
    if (part === undefined) return { ok: false, message: `no part ${args.part}.` };
    return { ok: true, body: { ...tokens, part: partView(project, state, render, part.id) } };
  }
  if (args.net !== undefined) {
    const net = project.circuit.nets.find((n) => n.id === args.net) ?? project.circuit.nets.find((n) => n.name === args.net);
    if (net === undefined) return { ok: false, message: `no net ${args.net}.` };
    return { ok: true, body: { ...tokens, net: netView(project, state, render, net.id) } };
  }
  const parts = project.circuit.parts.map((p) => {
    const placed = state.parts[p.id];
    return {
      id: p.id,
      type: p.type,
      ...(placed ? { at: placed.at, rot: placed.orient.rot, flip: placed.orient.flip } : {}),
    };
  });
  const nets = project.circuit.nets.map((n) => ({ id: n.id, ...(n.name !== undefined ? { name: n.name } : {}), kind: netKind(n) }));
  const partPage = pageOf(parts, args.cursor, QUERY_PAGE);
  if (!partPage.ok) return partPage;
  const netPage = pageOf(nets, args.cursor, QUERY_PAGE);
  if (!netPage.ok) return netPage;
  return {
    ok: true,
    body: {
      ...tokens,
      parts: partPage.items,
      partsTotal: parts.length,
      nets: netPage.items,
      netsTotal: nets.length,
      cursor: partPage.next ?? netPage.next,
    },
  };
}

function pinNets(project: LoadedProject, defs: PinDefs): Map<string, string> {
  const map = new Map<string, string>();
  const valid = validate(project.circuit, defs).valid;
  if (valid === undefined) return map;
  for (const [netId, eps] of valid.endpoints) {
    for (const ep of eps) {
      if (ep.kind === "terminal") map.set(`${ep.part}[${ep.number}]`, netId);
      const cls = classOf(ep, defs);
      for (const pin of defs[ep.part] ?? []) {
        if (classOf({ kind: "terminal", part: ep.part, number: pin.number }, defs) === cls) map.set(`${ep.part}[${pin.number}]`, netId);
      }
    }
  }
  return map;
}

function partView(project: LoadedProject, state: LayoutState, render: RenderModel, id: string): Record<string, unknown> {
  const part = project.circuit.parts.find((p) => p.id === id)!;
  const defs = projectPinDefs(project);
  const nets = pinNets(project, defs);
  const placed = state.parts[id];
  const pins = (defs[id] ?? []).map((pin) => {
    const drawn = render.electrical.pins.find((p) => p.part === id && p.number === pin.number);
    const netId = nets.get(`${id}[${pin.number}]`);
    const net = netId === undefined ? undefined : project.circuit.nets.find((n) => n.id === netId);
    return {
      number: pin.number,
      name: pin.name,
      role: pin.role,
      ...(drawn ? { at: drawn.at, dir: drawn.dir } : {}),
      net: net === undefined ? null : { id: net.id, ...(net.name !== undefined ? { name: net.name } : {}) },
    };
  });
  return {
    id: part.id,
    type: part.type,
    ...(part.props ? { props: part.props } : {}),
    ...(placed ? { at: placed.at, rot: placed.orient.rot, flip: placed.orient.flip } : {}),
    pins,
  };
}

function netView(project: LoadedProject, state: LayoutState, render: RenderModel, id: string): Record<string, unknown> {
  const net = project.circuit.nets.find((n) => n.id === id)!;
  const defs = projectPinDefs(project);
  const nets = pinNets(project, defs);
  const pins = [...nets.entries()]
    .filter(([, netId]) => netId === id)
    .map(([ep]) => ep)
    .map((ep) => {
      const m = /^(.+)\[(.+)\]$/.exec(ep);
      if (m === null) return undefined;
      const drawn = render.electrical.pins.find((p) => p.part === m[1] && p.number === m[2]);
      return { part: m[1], number: m[2], ...(drawn ? { at: drawn.at, dir: drawn.dir } : {}) };
    })
    .filter((p): p is NonNullable<typeof p> => p !== undefined);
  const route = state.routes[id];
  const drawn = route === undefined ? "none" : route.ports ? "port" : "wire";
  return {
    id: net.id,
    ...(net.name !== undefined ? { name: net.name } : {}),
    kind: netKind(net),
    ...(net.domain !== undefined ? { domain: net.domain } : {}),
    endpoints: net.endpoints,
    drawn,
    pins,
  };
}
