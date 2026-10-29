// esbuild settings for the playground (web/), shared by scripts/web.ts and tests/web.test.ts.
//
// The engine is plain TypeScript except for two small files that read from disk; in the browser
// build they are replaced:
//   src/text/font-file.ts  -> web/shims/font-file.ts (the page fetches the font and hands it over)
//   src/modules/files.ts   -> the module library's JSON files, written into the bundle
// Any other Node built-in (node:fs, or bare fs as opentype.js asks for it) resolves to a stub
// that throws if it is ever called. The examples are written into the page bundle as
// `virtual:examples`.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildOptions, Plugin } from "esbuild";

export const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const norm = (p: string) => path.resolve(p).replace(/\\/g, "/").toLowerCase();

function jsonFiles(dir: string, suffix = ".json"): Array<[string, string]> {
  return readdirSync(dir).filter((f) => f.endsWith(suffix)).sort().map((f) => [f, readFileSync(path.join(dir, f), "utf8")]);
}

export const browserEngine: Plugin = {
  name: "schem-browser-engine",
  setup(build) {
    const fontFile = norm(path.join(ROOT, "src/text/font-file.ts"));
    const moduleFiles = norm(path.join(ROOT, "src/modules/files.ts"));
    build.onResolve({ filter: /^(node:.*|fs|path|module|url|crypto|os)$/ }, (a) => ({ path: a.path, namespace: "node-stub" }));
    build.onLoad({ filter: /.*/, namespace: "node-stub" }, (a) => ({
      contents: `const no = () => { throw new Error(${JSON.stringify(`${a.path} is not available in the browser`)}); };
        export const readFileSync = no, readdirSync = no, writeFileSync = no, createRequire = no;
        export default {};`,
      loader: "js",
    }));
    build.onResolve({ filter: /font-file\.js$|files\.js$/ }, (a) => {
      const target = norm(path.join(a.resolveDir, a.path.replace(/\.js$/, ".ts")));
      if (target === fontFile) return { path: path.join(ROOT, "web/shims/font-file.ts") };
      if (target === moduleFiles) return { path: "modules", namespace: "schem-modules" };
      return undefined;
    });
    build.onLoad({ filter: /.*/, namespace: "schem-modules" }, () => ({
      contents: `export function moduleFiles() { return ${JSON.stringify(jsonFiles(path.join(ROOT, "src/modules")))}; }`,
      loader: "js",
    }));
    build.onResolve({ filter: /^virtual:examples$/ }, () => ({ path: "examples", namespace: "schem-examples" }));
    build.onLoad({ filter: /.*/, namespace: "schem-examples" }, () => ({
      contents: `export const EXAMPLES = ${JSON.stringify(jsonFiles(path.join(ROOT, "examples"), ".schem.json"))};`,
      loader: "js",
    }));
  },
};

/** Options shared by every playground bundle. */
export const common: BuildOptions = {
  bundle: true,
  format: "esm",
  target: "es2022",
  plugins: [browserEngine],
  legalComments: "none",
  logLevel: "warning",
};
