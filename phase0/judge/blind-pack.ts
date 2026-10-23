// Build a blind pack for the layer 6 judges.
//
//   npx tsx phase0/judge/blind-pack.ts --in <png folder> --out <new folder> [--seed N] [--judges 3]
//                                      [--pairs all|ours|none] [--ours schem[,name...]] [--cases phase0/cases]
//
// Input: PNGs named <tool>__<case>.png (for example schem__case03.png, netlistsvg__case03-summing.png).
// --ours names our tools (exact names, or name-stage such as schem-noedit); --pairs ours keeps only ours-vs-baseline pairs.
// Output:
//   <out>/pack/      give this to the judges: images/img-NN.png (shuffled, metadata stripped), netlists/caseNN.txt,
//                    pack.json (items, no tool names), RUBRIC.md, prompts/judge-NN.md (one filled prompt per judge)
//   <out>/sealed/    key.json: seed, image -> tool and case, pair A/B -> tool. Never give this to a judge.
//   <out>/answers/   empty; each judge writes answers/judge-NN.json here
// The same inputs and seed always give the same pack. Without --seed a random seed is drawn and recorded.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { netKind } from "../../src/core/model.js";
import { CASES, pinDefsFor } from "../check-cases.js";
import { cmpStr, oursMatcher, parseArgs, rng, sha256, shuffle, stripPng, subSeed } from "./lib.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = /^([A-Za-z0-9.-]+(?:_[A-Za-z0-9.-]+)*)__(case\d{2})([A-Za-z0-9._-]*)\.png$/;

export interface KeyImage { image: string; tool: string; case: string; set: string; source: string; sha256: string; droppedChunks: string[] }
export interface KeyPair { pair: string; case: string; a: { image: string; tool: string }; b: { image: string; tool: string } }
export interface Key { packId: string; seed: number; source: string; ours: string; images: KeyImage[]; pairs: KeyPair[]; judges: string[] }
export interface PackJson {
  packId: string;
  note: string;
  images: Array<{ image: string; case: string; netlist: string }>;
  pairs: Array<{ pair: string; case: string; a: string; b: string; netlist: string }>;
}

/** Find the frozen case file for "case03" in validation/ or test/. */
function findCase(casesDir: string, id: string): { path: string; set: string } {
  for (const set of ["validation", "test"]) {
    const dir = join(casesDir, set);
    if (!existsSync(dir)) continue;
    const hit = readdirSync(dir).filter((f) => f.startsWith(id) && f.endsWith(".json")).sort(cmpStr)[0];
    if (hit) return { path: join(dir, hit), set };
  }
  throw new Error(`no case file for ${id} under ${casesDir}`);
}

/** Plain-text netlist for judges: parts, then every net with every point that must be joined. */
export function netlistText(file: any): string {
  const { pinDefs } = pinDefsFor(file);
  const lines: string[] = [];
  lines.push(`Circuit: ${file.meta?.title ?? "(untitled)"}`, "");
  lines.push("Parts:");
  for (const p of file.circuit.parts) {
    const props = p.props ?? {};
    const what = [props.value, props.partNumber, props.label, props.color && `${props.color} LED`].filter(Boolean).join(", ");
    const def = file.assets?.definitions?.[p.type];
    const type = def?.name ? `module ${def.name}` : String(p.type).replace(/^module:/, "module ");
    lines.push(`  ${p.id.padEnd(5)} ${type}${what ? `  (${what})` : ""}`);
  }
  const pinText = (part: string, number: string): string => {
    const pin = pinDefs[part]?.find((x) => x.number === number);
    return pin && pin.name !== number ? `${part} pin ${number} (${pin.name})` : `${part} pin ${number}`;
  };
  const endpointText = (e: string): string => {
    let m = /^([A-Za-z][A-Za-z0-9_]*)\[(.+)\]$/.exec(e);
    if (m) return pinText(m[1]!, m[2]!);
    m = /^([A-Za-z][A-Za-z0-9_]*)\{(.+)\}$/.exec(e);
    if (m) {
      const members = (pinDefs[m[1]!] ?? []).filter((x) => x.group === m![2]).map((x) => x.number);
      return `${m[1]} ${m[2]} (any one of pins ${members.join(", ")}; joined inside the part)`;
    }
    m = /^([A-Za-z][A-Za-z0-9_]*)\.(.+)$/.exec(e);
    if (m) {
      const hits = (pinDefs[m[1]!] ?? []).filter((x) => x.name === m![2] || (x.aliases ?? []).includes(m![2]!));
      if (hits.length === 1) return pinText(m[1]!, hits[0]!.number);
      if (hits.length > 1) return `${m[1]} ${m[2]} (any one of pins ${hits.map((x) => x.number).join(", ")})`;
    }
    return e;
  };
  lines.push("", "Nets (every point listed on a line must be connected together, and to nothing else):");
  for (const n of file.circuit.nets) {
    const name = n.name ?? "(unnamed)";
    const kind = netKind(n);
    const tag = kind === "signal" ? "" : kind === "ground" ? " [ground: may be drawn with ground symbols]" : " [power: may be drawn with supply symbols named " + name + "]";
    lines.push(`  ${name}${tag}:`);
    lines.push(`      ${n.endpoints.map(endpointText).join("; ")}`);
  }
  const nc = file.circuit.nc ?? [];
  if (nc.length) lines.push("", "Not connected (should carry a no-connect mark or be left unconnected):", `  ${nc.map(endpointText).join("; ")}`);
  lines.push("", "Pins of chips and boards not listed above are unused and may be hidden.");
  return lines.join("\n") + "\n";
}

/** The judge prompt template: the part of JUDGE-PROMPT.md after the first line that is exactly "---". */
export function promptTemplate(): string {
  const text = readFileSync(join(HERE, "JUDGE-PROMPT.md"), "utf8");
  const i = text.indexOf("\n---\n");
  if (i < 0) throw new Error("JUDGE-PROMPT.md has no --- separator");
  return text.slice(i + 5).trimStart();
}

export function buildPack(opts: { inDir: string; outDir: string; seed: number; judges: number; pairs: "all" | "ours" | "none"; ours: string; casesDir: string }): Key {
  const { inDir, outDir, seed } = opts;
  if (existsSync(outDir) && readdirSync(outDir).length) throw new Error(`${outDir} exists and is not empty`);
  const files = readdirSync(inDir).filter((f) => f.toLowerCase().endsWith(".png")).sort(cmpStr);
  if (!files.length) throw new Error(`no .png files in ${inDir}`);
  const inputs = files.map((f) => {
    const m = NAME.exec(f);
    if (!m) throw new Error(`"${f}" is not named <tool>__<case>.png (case like case03 or case03-summing)`);
    return { file: f, tool: m[1]!, case: m[2]! };
  });
  const seen = new Set<string>();
  for (const x of inputs) {
    const k = `${x.tool}|${x.case}`;
    if (seen.has(k)) throw new Error(`two images for tool ${x.tool} and ${x.case}`);
    seen.add(k);
  }
  const caseInfo = new Map<string, { path: string; set: string; file: any }>();
  for (const id of [...new Set(inputs.map((x) => x.case))].sort(cmpStr)) {
    const c = findCase(opts.casesDir, id);
    caseInfo.set(id, { ...c, file: JSON.parse(readFileSync(c.path, "utf8")) });
  }

  const pack = join(outDir, "pack"), sealed = join(outDir, "sealed"), answers = join(outDir, "answers");
  for (const d of [join(pack, "images"), join(pack, "netlists"), join(pack, "prompts"), sealed, answers]) mkdirSync(d, { recursive: true });

  const next = rng(seed);
  const order = shuffle(inputs, next);
  const width = Math.max(2, String(order.length).length);
  const images: KeyImage[] = order.map((x, i) => {
    const image = `img-${String(i + 1).padStart(width, "0")}.png`;
    const raw = readFileSync(join(inDir, x.file));
    const { png, dropped } = stripPng(raw);
    writeFileSync(join(pack, "images", image), png);
    return { image, tool: x.tool, case: x.case, set: caseInfo.get(x.case)!.set, source: x.file, sha256: sha256(raw), droppedChunks: dropped };
  });
  for (const [id, c] of caseInfo) writeFileSync(join(pack, "netlists", `${id}.txt`), netlistText(c.file));

  // Pairs: two drawings of the same case from different tools; A/B side drawn at random.
  const raw: Array<[KeyImage, KeyImage]> = [];
  const isOurs = oursMatcher(opts.ours);
  if (opts.pairs !== "none") {
    for (const id of caseInfo.keys()) {
      const imgs = images.filter((x) => x.case === id).sort((a, b) => cmpStr(a.tool, b.tool));
      for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) {
        const x = imgs[i]!, y = imgs[j]!;
        if (opts.pairs === "ours" && isOurs(x.tool) === isOurs(y.tool)) continue;
        raw.push(next() < 0.5 ? [x, y] : [y, x]);
      }
    }
  }
  const pairW = Math.max(2, String(raw.length).length);
  const pairs: KeyPair[] = shuffle(raw, next).map(([a, b], i) => ({
    pair: `pair-${String(i + 1).padStart(pairW, "0")}`, case: a.case,
    a: { image: a.image, tool: a.tool }, b: { image: b.image, tool: b.tool },
  }));

  const packId = `pack-${sha256(`pack:${seed}:${images.map((x) => x.sha256).join(",")}`).slice(0, 10)}`;
  const judges = Array.from({ length: opts.judges }, (_, i) => `judge-${String(i + 1).padStart(2, "0")}`);
  const key: Key = { packId, seed, source: resolve(inDir), ours: opts.ours, images, pairs, judges };
  const packJson: PackJson = {
    packId,
    note: "Blind pack. Images are anonymised and shuffled; nothing here says which program drew which image.",
    images: [...images].sort((a, b) => cmpStr(a.image, b.image)).map((x) => ({ image: `images/${x.image}`, case: x.case, netlist: `netlists/${x.case}.txt` })),
    pairs: pairs.map((p) => ({ pair: p.pair, case: p.case, a: `images/${p.a.image}`, b: `images/${p.b.image}`, netlist: `netlists/${p.case}.txt` })),
  };
  writeFileSync(join(pack, "pack.json"), JSON.stringify(packJson, null, 2) + "\n");
  writeFileSync(join(sealed, "key.json"), JSON.stringify(key, null, 2) + "\n");
  const rubric = readFileSync(join(HERE, "RUBRIC.md"), "utf8");
  writeFileSync(join(pack, "RUBRIC.md"), rubric);

  // One prompt per judge, each with its own seeded item order.
  const template = promptTemplate();
  const packAbs = resolve(pack).split("\\").join("/");
  for (const j of judges) {
    const r = rng(subSeed(seed, j));
    const abs = shuffle(packJson.images, r).map((x, i) => `${i + 1}. Image \`${packAbs}/${x.image}\`, netlist \`${packAbs}/${x.netlist}\``);
    const prs = shuffle(packJson.pairs, r).map((p, i) => `${i + 1}. ${p.pair}: A = \`${packAbs}/${p.a}\`, B = \`${packAbs}/${p.b}\`, netlist \`${packAbs}/${p.netlist}\``);
    const fill: Record<string, string> = {
      JUDGE_ID: j, PACK_DIR: packAbs, PACK_ID: packId, RUBRIC: rubric.trim(),
      ABSOLUTE_ITEMS: abs.join("\n"),
      PAIRWISE_ITEMS: prs.length ? prs.join("\n") : "(No pairs in this pack. Write an empty \"pairwise\" list.)",
      ANSWER_PATH: `${resolve(answers).split("\\").join("/")}/${j}.json`,
    };
    const text = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, k: string) => {
      if (!(k in fill)) throw new Error(`unknown placeholder {{${k}}}`);
      return fill[k]!;
    });
    writeFileSync(join(pack, "prompts", `${j}.md`), text);
  }
  return key;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const str = (k: string, d?: string): string => {
    const v = a.get(k);
    if (typeof v === "string") return v;
    if (d !== undefined) return d;
    throw new Error(`--${k} is required`);
  };
  const seedArg = a.get("seed");
  const seed = typeof seedArg === "string" ? Number(seedArg) >>> 0 : randomBytes(4).readUInt32BE(0);
  if (typeof seedArg === "string" && !/^\d+$/.test(seedArg)) throw new Error("--seed must be a non-negative integer");
  const pairs = str("pairs", "all");
  if (pairs !== "all" && pairs !== "ours" && pairs !== "none") throw new Error("--pairs must be all, ours or none");
  const key = buildPack({
    inDir: str("in"), outDir: str("out"), seed, judges: Number(str("judges", "3")), pairs,
    ours: str("ours", "schem"), casesDir: str("cases", CASES),
  });
  const dropped = key.images.filter((x) => x.droppedChunks.length).length;
  console.log(`${key.packId}: ${key.images.length} images, ${key.pairs.length} pairs, ${key.judges.length} judge prompts, seed ${key.seed}`);
  console.log(`metadata chunks removed from ${dropped} image(s); key in ${join(str("out"), "sealed", "key.json")} (do not give to judges)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e: any) { console.error(`blind-pack: ${e.message ?? e}`); process.exitCode = 1; }
}
