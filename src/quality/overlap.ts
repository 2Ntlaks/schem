// Verification layer 2: nothing overlaps, everything is on grid, nothing leaves the sheet
// (SPEC 9.1 rules 3 and 6). Wires against keep-outs are already checked by the verifier.

import { key, type Box, type Pt } from "../geom/geom.js";
import type { RenderModel } from "../render/model.js";
import { conductors, overlapArea, textBlocks } from "./drawing.js";

export interface QualityIssue { code: string; message: string; at?: string }

/** Part keep-outs are grid-rounded outward, so text is tested against them shrunk by this much. */
const KEEPOUT_SLACK = 0.5;

export function checkOverlaps(m: RenderModel): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const el = m.electrical;
  const parts = (el.keepouts ?? []).filter((k) => !k.part.includes(":"));
  const ports = (el.keepouts ?? []).filter((k) => k.part.startsWith("port:"));
  const texts = textBlocks(m);
  const fmt = (b: Box) => `(${r(b.x)}, ${r(b.y)}) ${r(b.w)}x${r(b.h)}`;

  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    if (overlapArea(parts[i]!, parts[j]!) > 0) issues.push({ code: "part-overlap", message: `parts ${parts[i]!.part} and ${parts[j]!.part} overlap`, at: parts[i]!.part });
  }
  for (let i = 0; i < ports.length; i++) {
    for (let j = i + 1; j < ports.length; j++) {
      if (overlapArea(ports[i]!, ports[j]!) > 0) issues.push({ code: "port-overlap", message: `${ports[i]!.part} and ${ports[j]!.part} overlap`, at: ports[i]!.part });
    }
    for (const p of parts) if (overlapArea(ports[i]!, p) > 0) issues.push({ code: "port-on-part", message: `${ports[i]!.part} overlaps part ${p.part}`, at: ports[i]!.part });
  }

  const ownerPart = (owner: string) => owner.replace(/^(label|pin|port):/, "").replace(/\[.*$/, "");
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i]!;
    for (let j = i + 1; j < texts.length; j++) {
      if (overlapArea(t, texts[j]!) > 0) issues.push({ code: "text-overlap", message: `text "${t.text}" (${t.owner}) overlaps "${texts[j]!.text}" (${texts[j]!.owner})`, at: t.owner });
    }
    for (const p of parts) {
      if (p.part === ownerPart(t.owner)) continue; // own label and pin names are placed against the part
      if (overlapArea(t, p, KEEPOUT_SLACK) > 0) issues.push({ code: "text-on-part", message: `text "${t.text}" (${t.owner}) overlaps part ${p.part}`, at: t.owner });
    }
    for (const q of ports) {
      if (t.owner.startsWith("port:") && q.part === t.owner) continue;
      if (overlapArea(t, q, KEEPOUT_SLACK) > 0) issues.push({ code: "text-on-port", message: `text "${t.text}" (${t.owner}) overlaps ${q.part}`, at: t.owner });
    }
    if (!inside(t, m.bounds)) issues.push({ code: "text-clipped", message: `text "${t.text}" (${t.owner}) at ${fmt(t)} leaves the sheet ${fmt(m.bounds)}`, at: t.owner });
  }

  // Wires through text: every unit edge against the exact text boxes (port text is excluded,
  // its own stub may start under it; port keep-outs are covered by the verifier).
  const c = conductors(m);
  for (const t of texts) {
    if (t.owner.startsWith("port:")) continue;
    const hit = c.edges.find(([a, b]) => segmentHitsBox(a, b, t));
    if (hit) issues.push({ code: "wire-on-text", message: `a wire at ${key(hit[0])}-${key(hit[1])} runs through text "${t.text}" (${t.owner})`, at: t.owner });
  }

  const offGrid = (p: Pt) => !Number.isInteger(p[0]) || !Number.isInteger(p[1]);
  for (const p of el.pins) if (offGrid(p.at)) issues.push({ code: "off-grid", message: `pin ${p.part}[${p.number}] at ${p.at.join(",")} is off grid`, at: `${p.part}[${p.number}]` });
  for (const p of el.ports) if (offGrid(p.at)) issues.push({ code: "off-grid", message: `port "${p.text}" at ${p.at.join(",")} is off grid` });
  for (const d of el.dots) if (offGrid(d)) issues.push({ code: "off-grid", message: `dot at ${d.join(",")} is off grid` });
  for (const k of el.keepouts ?? []) if (!inside(k, m.bounds)) issues.push({ code: "art-clipped", message: `${k.part} at ${fmt(k)} leaves the sheet`, at: k.part });
  return issues;
}

function inside(b: Box, s: Box): boolean {
  const e = 1e-6;
  return b.x >= s.x - e && b.y >= s.y - e && b.x + b.w <= s.x + s.w + e && b.y + b.h <= s.y + s.h + e;
}

function segmentHitsBox(a: Pt, b: Pt, t: Box): boolean {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  return x1 > t.x && x0 < t.x + t.w && y1 > t.y && y0 < t.y + t.h;
}

function r(n: number): string { return String(Math.round(n * 10) / 10); }
