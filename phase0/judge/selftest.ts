// End-to-end self-test of the judge kit on throwaway images (never engine output).
//   npx tsx phase0/judge/selftest.ts [--keep <folder>]
// Generates flat test PNGs for 4 made-up tool names x 12 cases, builds a pack twice with one seed, checks it is
// deterministic, anonymised and stripped of metadata, writes simulated judge and owner answers (with deliberate
// faults), tallies them, and checks the statistics on hand-computed examples. Exit 1 on any failure.

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { buildPack, type Key } from "./blind-pack.js";
import { CASES } from "../check-cases.js";
import { oursMatcher, rng } from "./lib.js";
import { cohenKappa, fleissKappa, rankAgreement, tally, type Rater } from "./tally.js";

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };

// ---- throwaway PNGs (RGB, with tEXt and tIME chunks that must be stripped)
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => {
  const t = Buffer.from(type, "latin1"), len = Buffer.alloc(4), c = Buffer.alloc(4);
  len.writeUInt32BE(data.length); c.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
};
function testPng(w: number, h: number, a: number, b: number, software: string): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h, 255);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) if ((x + a) % 40 < 3 || (y + b) % 30 < 2) raw.fill(20, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
    chunk("tEXt", Buffer.from(`Software\0${software}`, "latin1")), chunk("tIME", Buffer.from([7, 234, 10, 23, 12, 0, 0])),
    chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const chunkTypes = (b: Buffer): string[] => { const t: string[] = []; for (let o = 8; o < b.length;) { const n = b.readUInt32BE(o); t.push(b.toString("latin1", o + 4, o + 8)); o += 12 + n; } return t; };

const keepArg = process.argv.indexOf("--keep");
const root = keepArg > 0 ? process.argv[keepArg + 1]! : mkdtempSync(join(tmpdir(), "schem-judge-selftest-"));
mkdirSync(root, { recursive: true });
const pngDir = join(root, "png");
mkdirSync(pngDir, { recursive: true });
const TOOLS = ["schem", "toolx", "tooly", "schemdraw"];
const CASE_IDS = ["case01-led", "case02", "case03-summing", "case04", "case05", "case06", "case07", "case08", "case09", "case10", "case11", "case12"];
TOOLS.forEach((t, ti) => CASE_IDS.forEach((c, ci) => writeFileSync(join(pngDir, `${t}__${c}.png`), testPng(160, 120, ci * 7, ti * 9, `${t} generator 1.0`))));

// ---- pack, twice
const opts = { inDir: pngDir, seed: 42, judges: 3, pairs: "all" as const, ours: "schem", casesDir: CASES };
const key: Key = buildPack({ ...opts, outDir: join(root, "packA") });
buildPack({ ...opts, outDir: join(root, "packB") });
const packA = join(root, "packA", "pack"), packB = join(root, "packB", "pack");
const same = (rel: string) => readFileSync(join(packA, rel)).equals(readFileSync(join(packB, rel)));
check(readdirSync(join(packA, "images")).every((f) => same(join("images", f))) && same("pack.json") && readdirSync(join(packA, "netlists")).every((f) => same(join("netlists", f))), "same seed gives identical images, pack.json and netlists");
check(key.images.length === 48 && key.pairs.length === 72, "48 images and 72 within-case pairs (6 per case)");
const leaky = readdirSync(packA, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
  .filter((e) => /toolx|tooly|schemdraw|schem__|generator 1\.0/.test(readFileSync(join(e.parentPath, e.name), "latin1")));
check(leaky.length === 0, `no tool name or software string anywhere in the judges' folder${leaky.length ? `: ${leaky.map((e) => e.name).join(", ")}` : ""}`);
check(readdirSync(join(packA, "images")).every((f) => chunkTypes(readFileSync(join(packA, "images", f))).join(",") === "IHDR,IDAT,IEND"), "metadata chunks removed (only IHDR, IDAT, IEND left)");
const order = key.images.map((x) => x.source);
check(order.join() !== [...order].sort().join(), "image order is shuffled");
const prompts = readdirSync(join(packA, "prompts"));
check(prompts.length === 3 && prompts.every((f) => !readFileSync(join(packA, "prompts", f), "utf8").includes("{{")), "3 judge prompts, every placeholder filled");
const firstItem = (f: string) => /1\. Image `[^`]*\/(img-\d+\.png)`/.exec(readFileSync(join(packA, "prompts", f), "utf8"))?.[1];
check(new Set(prompts.map(firstItem)).size > 1, "judges get different item orders");
check(readFileSync(join(packA, "netlists", "case07.txt"), "utf8").includes("U1 pin 7 (VCC)"), "netlists name pins by number and name");

// ---- simulated answers: hidden per-tool quality plus noise; judge-03 has deliberate faults
const quality: Record<string, number> = { schem: 4.2, toolx: 2.6, tooly: 3.0, schemdraw: 3.4 };
const r = rng(7);
const latent = new Map(key.images.map((x) => [x.image, quality[x.tool]! + (r() - 0.5) * 1.6]));
const wrong = new Set(key.images.filter((x) => x.tool === "toolx" && (x.case === "case04" || x.case === "case11")).map((x) => x.image));
const answer = (judge: string, bias: number, noise: number) => {
  const absolute = key.images.map((x) => {
    const bad = wrong.has(x.image);
    const score = bad ? 1 : Math.max(1, Math.min(5, Math.round(latent.get(x.image)! + bias + (r() - 0.5) * noise)));
    return { image: x.image, connections: { correct: !bad, errors: bad ? ["net GND: R2 pin 2 not connected"] : [] }, checklist: { connections: bad ? "major" : "good", crossings: score >= 4 ? "good" : "major" }, score, notes: "simulated" };
  });
  const s = new Map(absolute.map((a) => [a.image, a.score]));
  const pairwise = key.pairs.map((p) => { const d = s.get(p.a.image)! - s.get(p.b.image)!; return { pair: p.pair, choice: d > 0 ? "A" : d < 0 ? "B" : "tie", reason: "simulated" }; });
  return { judge, pack: key.packId, absolute, pairwise } as any;
};
const ans = join(root, "packA", "answers");
const j3 = answer("judge-03", 0.2, 1.4);
j3.absolute[0] = { ...j3.absolute[0], connections: { correct: false, errors: [] }, score: 3 };
j3.absolute.splice(5, 1);
j3.pairwise[0].choice = "C";
writeFileSync(join(ans, "judge-01.json"), JSON.stringify(answer("judge-01", 0, 1.0)));
writeFileSync(join(ans, "judge-02.json"), JSON.stringify(answer("judge-02", -0.4, 1.2)));
writeFileSync(join(ans, "judge-03.json"), JSON.stringify(j3));
writeFileSync(join(root, "owner.json"), JSON.stringify({ ...answer("owner", -0.2, 0.8), pairwise: [] }));
const t = tally(join(root, "packA"), { owner: join(root, "owner.json") });
writeFileSync(join(root, "report.md"), t.markdown);
const json: any = t.json;
const p3 = json.judges.find((j: any) => j.id === "judge-03").problems.join("\n");
check(/rubric forces 1/.test(p3) && /not rated/.test(p3) && /is not A, B or tie/.test(p3) && /no errors listed/.test(p3), "faulty answers are flagged (incorrect scored 3, missing image, bad choice, no errors)");
check(json.judges.find((j: any) => j.id === "judge-01").problems.length === 0, "a clean answer has no problems");
check(json.gates.every((g: any) => g.tool === "schem") && json.gates.length === 2, "gate rows only for our tool (schemdraw is a baseline), panel and owner");
check(json.perTool.find((x: any) => x.tool === "toolx").majorityIncorrect === 2, "incorrect drawings counted by majority");
check(/Fleiss' kappa/.test(t.markdown) && /Within-case order agreement/.test(t.markdown), "agreement figures reported");

// ---- statistics on hand-computed examples
const m = (xs: number[]) => new Map(xs.map((s, i) => [`i${i}`, s]));
const rater = (scores: Map<string, number>): Rater => ({ id: "x", scores, correct: new Map(), choices: new Map(), problems: [], levels: new Map() });
const a = m([5, 1, 4, 4]), b = m([4, 2, 3, 5]);
check(Math.abs(fleissKappa([rater(a), rater(b)], ["i0", "i1", "i2", "i3"]).kappa - 0.46667) < 1e-4, "Fleiss' kappa = 0.4667 on the worked example");
check(Math.abs(cohenKappa(a, b).kappa - 0.5) < 1e-9, "Cohen's kappa = 0.5 on the worked example");
const ra = rankAgreement(new Map([["x", 5], ["y", 3], ["z", 1], ["w", 2]]), new Map([["x", 4], ["y", 4], ["z", 2], ["w", 5]]),
  { images: [{ image: "x", case: "c" }, { image: "y", case: "c" }, { image: "z", case: "c" }, { image: "w", case: "d" }] } as any);
check(ra.agree === 2 && ra.comparable === 2 && ra.ties === 1, "within-case ranking agreement: 2 of 2 comparable, 1 tie");
const ours = oursMatcher("schem");
check(ours("schem") && ours("schem-edit") && !ours("schemdraw"), "our-tool matching: schem, schem-edit yes; schemdraw no");

console.log(`\n${failures ? `${failures} FAILURE(S)` : "ALL OK"}  (files in ${root})`);
if (keepArg < 0 && !failures) rmSync(root, { recursive: true, force: true });
process.exitCode = failures ? 1 : 0;
