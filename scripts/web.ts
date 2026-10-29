// Build or preview the playground (web/) into out/web/.
//
//   npm run web:build     one build, minified
//   npm run web:serve     build, then serve on http://localhost:8080 and rebuild on change
//
// The page and the worker are bundled with esbuild (settings in scripts/lib/web-bundle.ts); the
// HTML, the stylesheet and the DejaVu fonts are copied next to them. Everything is static, so
// out/web/ can be hosted anywhere (GitHub Pages).

import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { context, build, type BuildOptions } from "esbuild";
import { common, ROOT } from "./lib/web-bundle.js";

const OUT = path.join(ROOT, "out", "web");
const FONTS = ["DejaVuSans.ttf", "DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf"];

function copyStatic(): void {
  mkdirSync(path.join(OUT, "fonts"), { recursive: true });
  for (const f of ["index.html", "style.css"]) copyFileSync(path.join(ROOT, "web", f), path.join(OUT, f));
  for (const f of FONTS) copyFileSync(path.join(ROOT, "node_modules", "dejavu-fonts-ttf", "ttf", f), path.join(OUT, "fonts", f));
}

const options: BuildOptions = {
  ...common,
  platform: "browser",
  entryPoints: { main: path.join(ROOT, "web", "main.ts"), worker: path.join(ROOT, "web", "worker.ts") },
  outdir: OUT,
  minify: true,
  sourcemap: "linked",
};

const mode = process.argv[2] ?? "build";
rmSync(OUT, { recursive: true, force: true });
copyStatic();
if (mode === "serve") {
  const ctx = await context({ ...options, plugins: [...(options.plugins ?? []), { name: "static", setup: (b) => b.onEnd(copyStatic) }] });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: OUT, port: 8080, host: "127.0.0.1" });
  console.log(`playground on http://localhost:${port} (Ctrl+C to stop)`);
} else {
  const result = await build({ ...options, metafile: true });
  const sizes = Object.entries(result.metafile!.outputs).filter(([f]) => f.endsWith(".js")).map(([f, o]) => `${path.basename(f)} ${Math.round(o.bytes / 1024)} KB`);
  console.log(`wrote ${path.relative(ROOT, OUT)}/ (${sizes.join(", ")})`);
}
