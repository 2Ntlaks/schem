// Build the npm package's command into dist/ (npm run build; npm pack runs it through prepack).
//
//   dist/schem.js                  src/bin.ts bundled with esbuild: the CLI and the MCP server
//   dist/fonts/DejaVuSans.ttf      the one font the engine reads at run time
//   dist/fonts/LICENSE-DejaVu.txt  that font's licence, which must travel with it
//
// The engine reads three things from disk when it runs from source. In the bundle each one is
// handled here, so the installed package does not depend on where its source files were:
//   src/text/font-file.ts  reads DejaVuSans.ttf from the dejavu-fonts-ttf package. The bundle
//                          reads the copy in dist/fonts/ instead, so that 12 MB font package
//                          stays a dev dependency.
//   src/modules/files.ts   reads the module library's *.json next to it. The bundle carries
//                          those files as text, as the playground build does (scripts/lib/web-bundle.ts).
//   package.json           read for the version. src/cli.ts looks one folder up from itself,
//                          which from dist/ is the package root; src/mcp/server.ts looks two
//                          folders up, so its path is rewritten to one.
// src/cli.ts and src/mcp/main.ts each start themselves when they are the script node was given.
// In one bundle both would see the same file name, so their isEntryPoint() is made to return
// false and src/bin.ts decides which one runs.
//
// The npm dependencies (@resvg/resvg-js with its native binaries, opentype.js) stay outside
// the bundle and are installed with the package.

import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";

export const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DIST = path.join(ROOT, "dist");
const FONT_DIR = path.join(ROOT, "node_modules", "dejavu-fonts-ttf");

const norm = (p: string) => path.resolve(p).replace(/\\/g, "/").toLowerCase();

/** Exact source edits made while bundling. Each must match exactly once, or the build fails. */
const REWRITES: Record<string, Array<{ find: string; replace: string; why: string }>> = {
  "src/cli.ts": [
    { find: "function isEntryPoint(): boolean {", replace: "function isEntryPoint(): boolean {\n  return false;", why: "src/bin.ts starts the CLI" },
  ],
  "src/mcp/main.ts": [
    { find: "function isEntryPoint(): boolean {", replace: "function isEntryPoint(): boolean {\n  return false;", why: "src/bin.ts starts the server" },
  ],
  "src/mcp/server.ts": [
    { find: 'new URL("../../package.json", import.meta.url)', replace: 'new URL("../package.json", import.meta.url)', why: "dist/schem.js is one folder below package.json" },
  ],
};

function countOf(text: string, find: string): number {
  return text.split(find).length - 1;
}

const nodePackage: Plugin = {
  name: "schem-node-package",
  setup(b) {
    const fontFile = norm(path.join(ROOT, "src/text/font-file.ts"));
    const moduleFiles = norm(path.join(ROOT, "src/modules/files.ts"));
    const rewrites = new Map(Object.entries(REWRITES).map(([f, r]) => [norm(path.join(ROOT, f)), { file: f, list: r }]));

    b.onResolve({ filter: /font-file\.js$|files\.js$/ }, (a) => {
      const target = norm(path.join(a.resolveDir, a.path.replace(/\.js$/, ".ts")));
      if (target === fontFile) return { path: "font-file", namespace: "schem-font" };
      if (target === moduleFiles) return { path: "modules", namespace: "schem-modules" };
      return undefined;
    });
    b.onLoad({ filter: /.*/, namespace: "schem-font" }, () => ({
      contents: `import { readFileSync } from "node:fs";
        import { fileURLToPath } from "node:url";
        export function fontPath() { return fileURLToPath(new URL("./fonts/DejaVuSans.ttf", import.meta.url)); }
        export function fontBytes() { return readFileSync(fontPath()); }`,
      loader: "js",
    }));
    b.onLoad({ filter: /.*/, namespace: "schem-modules" }, () => {
      const dir = path.join(ROOT, "src/modules");
      const files = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f, readFileSync(path.join(dir, f), "utf8")]);
      return { contents: `export function moduleFiles() { return ${JSON.stringify(files)}; }`, loader: "js" };
    });
    b.onLoad({ filter: /\.ts$/ }, (a) => {
      const entry = rewrites.get(norm(a.path));
      if (entry === undefined) return undefined;
      let text = readFileSync(a.path, "utf8");
      for (const r of entry.list) {
        const n = countOf(text, r.find);
        if (n !== 1) {
          return { errors: [{ text: `${entry.file}: expected "${r.find}" once (${r.why}), found it ${n} times. Update REWRITES in scripts/build.ts.` }] };
        }
        text = text.replace(r.find, () => r.replace);
      }
      return { contents: text, loader: "ts" };
    });
  },
};

export async function buildPackage(): Promise<void> {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(path.join(DIST, "fonts"), { recursive: true });
  copyFileSync(path.join(FONT_DIR, "ttf", "DejaVuSans.ttf"), path.join(DIST, "fonts", "DejaVuSans.ttf"));
  copyFileSync(path.join(FONT_DIR, "LICENSE"), path.join(DIST, "fonts", "LICENSE-DejaVu.txt"));

  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  const result = await build({
    entryPoints: [path.join(ROOT, "src", "bin.ts")],
    outfile: path.join(DIST, "schem.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Every runtime dependency stays an import; package.json lists them, npm installs them.
    external: Object.keys(pkg.dependencies ?? {}),
    banner: { js: "#!/usr/bin/env node" },
    plugins: [nodePackage],
    legalComments: "none",
    logLevel: "warning",
    metafile: true,
  });

  // Fail if anything outside the bundle is imported that the package does not declare.
  const declared = new Set(Object.keys(pkg.dependencies ?? {}));
  const imported = new Set<string>();
  for (const out of Object.values(result.metafile.outputs)) {
    for (const i of out.imports) if (i.external && !isBuiltin(i.path)) imported.add(i.path.split("/").slice(0, i.path.startsWith("@") ? 2 : 1).join("/"));
  }
  const missing = [...imported].filter((p) => !declared.has(p));
  if (missing.length > 0) throw new Error(`the bundle imports packages not in dependencies: ${missing.join(", ")}`);
  const unused = [...declared].filter((p) => !imported.has(p));
  if (unused.length > 0) throw new Error(`dependencies the bundle never imports (move them to devDependencies): ${unused.join(", ")}`);

  const bytes = Object.values(result.metafile.outputs).reduce((s, o) => s + o.bytes, 0);
  console.log(`wrote dist/schem.js (${Math.round(bytes / 1024)} KB) and dist/fonts/; external: ${[...imported].sort().join(", ")}`);
}

const isMain = process.argv[1] !== undefined && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url));
if (isMain) await buildPackage();
