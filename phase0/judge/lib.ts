// Shared helpers for the judge kit. node: built-ins only.

import { createHash } from "node:crypto";

export const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `--key value` and `--flag` arguments. */
export function parseArgs(argv: string[]): Map<string, string | true> {
  const m = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new Error(`unexpected argument "${a}"`);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { m.set(a.slice(2), next); i++; } else m.set(a.slice(2), true);
  }
  return m;
}

/** mulberry32: small, well-known 32-bit seeded generator. Same seed, same sequence, on every platform. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle of a copy. */
export function shuffle<T>(items: readonly T[], next: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** A 32-bit sub-seed derived from a seed and a label (per-judge orders). */
export function subSeed(seed: number, label: string): number {
  return createHash("sha256").update(`${seed}:${label}`).digest().readUInt32BE(0);
}

/**
 * Is `tool` one of ours? `ours` is a comma-separated list of names; a tool matches a name exactly or as
 * "<name>-<stage>" (schem-noedit, schem-edit). Plain prefixes are not enough: "schemdraw" is a baseline.
 */
export function oursMatcher(ours: string): (tool: string) => boolean {
  const names = ours.split(",").map((s) => s.trim()).filter(Boolean);
  return (tool) => names.some((n) => tool === n || tool.startsWith(`${n}-`));
}

export const sha256 = (buf: Buffer | string): string => createHash("sha256").update(buf).digest("hex");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Chunks needed to show the image correctly. Everything else (text, time, EXIF, physical size, ICC name) is dropped. */
const KEEP = new Set(["IHDR", "PLTE", "tRNS", "gAMA", "cHRM", "sRGB", "IDAT", "IEND"]);

/**
 * Remove ancillary PNG chunks that can identify the producing program (tEXt "Software", tIME, pHYs ...).
 * Kept chunks are copied byte for byte (their CRCs stay valid). Throws if the file is not a PNG.
 */
export function stripPng(buf: Buffer): { png: Buffer; dropped: string[] } {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("not a PNG file");
  const parts: Buffer[] = [PNG_SIGNATURE];
  const dropped: string[] = [];
  let off = 8, sawEnd = false;
  while (off < buf.length) {
    if (off + 12 > buf.length) throw new Error("truncated PNG chunk");
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const end = off + 12 + len;
    if (end > buf.length) throw new Error(`truncated PNG chunk ${type}`);
    if (KEEP.has(type)) parts.push(buf.subarray(off, end)); else dropped.push(type);
    off = end;
    if (type === "IEND") { sawEnd = true; break; }
  }
  if (!sawEnd) throw new Error("PNG has no IEND chunk");
  return { png: Buffer.concat(parts), dropped };
}

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}
export function mean(xs: readonly number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
/** Population standard deviation (the judges are the whole panel, not a sample of one). */
export function sd(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}
export const fmt = (x: number, d = 2): string => (Number.isFinite(x) ? x.toFixed(d) : "-");
export const pct = (num: number, den: number): string => (den ? `${((100 * num) / den).toFixed(0)}%` : "-");
