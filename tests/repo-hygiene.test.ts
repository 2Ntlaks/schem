// Repository documentation, metadata, and packaging hygiene checks.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILTIN } from "../src/symbols/library.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const HISTORICAL_ROOT_DOCS = new Set([
  "PHASE0A-NOTES.md",
  "PHASE0B-NOTES.md",
  "PHASE0B-PROGRESS-2026-10-25.md",
  "PROJECT-AUDIT-2026-10-25.md",
]);

const FOLDER_READMES = [
  "scripts/README.md",
  "bench/README.md",
  "cases/README.md",
  "archive/README.md",
  "docs/agent-reports/README.md",
];

function rootDocs(): string[] {
  return readdirSync(path.join(ROOT, "docs"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => `docs/${f}`);
}

function linkCheckedDocs(): string[] {
  return [
    "README.md",
    "CONTRIBUTING.md",
    "examples/README.md",
    "skills/schem/SKILL.md",
    ...rootDocs(),
    ...FOLDER_READMES,
  ];
}

function dashCheckedDocs(): string[] {
  const userGuides = rootDocs().filter((f) => !HISTORICAL_ROOT_DOCS.has(path.basename(f)));
  return [
    "README.md",
    "CONTRIBUTING.md",
    "examples/README.md",
    "skills/schem/SKILL.md",
    ...userGuides,
    ...FOLDER_READMES,
  ];
}

/** Strip fenced code blocks and replace inline code spans so literal examples are not parsed as links. */
function stripCode(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\r\n]+`/g, "code");
}

function extractLocalTargets(markdown: string): string[] {
  const stripped = stripCode(markdown);
  const targets: string[] = [];

  const pushIfLocal = (raw: string): void => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const unwrapped = trimmed.startsWith("<") && trimmed.endsWith(">")
      ? trimmed.slice(1, -1).trim()
      : trimmed.split(/\s+/)[0] ?? "";
    if (!unwrapped || /^(https?:|mailto:|data:|#)/i.test(unwrapped)) return;
    const filePart = unwrapped.split("#")[0]?.split("?")[0] ?? "";
    if (filePart) targets.push(filePart);
  };

  // Standard and nested-bracket markdown links (such as image badges wrapped in a link).
  for (const m of stripped.matchAll(/\[(?:[^\[\]]|\[[^\]]*\])*\]\(([^)]+)\)/g)) {
    if (m[1]) pushIfLocal(m[1]);
  }
  // Markdown image targets, including images nested inside a link badge.
  for (const m of stripped.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    if (m[1]) pushIfLocal(m[1]);
  }
  // HTML <img src="..."> tags.
  for (const m of stripped.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    if (m[1]) pushIfLocal(m[1]);
  }

  return targets;
}

describe("repo hygiene", () => {
  it("resolves every local markdown link and HTML img src in documentation", () => {
    const broken: string[] = [];
    for (const rel of linkCheckedDocs()) {
      const abs = path.join(ROOT, rel);
      expect(existsSync(abs), `expected doc file to exist: ${rel}`).toBe(true);
      const dir = path.dirname(abs);
      const text = readFileSync(abs, "utf8");
      for (const target of extractLocalTargets(text)) {
        const resolved = path.resolve(dir, target);
        if (!existsSync(resolved)) {
          broken.push(`${rel} -> ${target}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("has zero em dashes or en dashes in user-facing documentation", () => {
    const offending: string[] = [];
    for (const rel of dashCheckedDocs()) {
      const text = readFileSync(path.join(ROOT, rel), "utf8");
      const lines = text.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (/[\u2013\u2014]/.test(line)) {
          offending.push(`${rel}:${idx + 1}`);
        }
      });
    }
    expect(offending).toEqual([]);
  });

  it("lists every built-in symbol and board module in docs/parts.md", () => {
    const partsDoc = readFileSync(path.join(ROOT, "docs", "parts.md"), "utf8");

    const missingSymbols = Object.keys(BUILTIN)
      .sort()
      .filter((id) => !partsDoc.includes(`\`${id}\``));
    expect(missingSymbols).toEqual([]);

    const modulesDir = path.join(ROOT, "src", "modules");
    const moduleIds = readdirSync(modulesDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => {
        const parsed = JSON.parse(readFileSync(path.join(modulesDir, f), "utf8")) as { id: string };
        return parsed.id;
      });
    expect(moduleIds.length).toBeGreaterThan(0);

    const missingModules = moduleIds.filter((id) => !partsDoc.includes(`\`${id}\``));
    expect(missingModules).toEqual([]);
  });

  it("mentions every example circuit file in examples/README.md", () => {
    const examplesDir = path.join(ROOT, "examples");
    const readme = readFileSync(path.join(examplesDir, "README.md"), "utf8");
    const exampleFiles = readdirSync(examplesDir)
      .filter((f) => f.endsWith(".schem") || f.endsWith(".schem.json"))
      .sort();

    expect(exampleFiles.length).toBeGreaterThan(0);
    const missing = exampleFiles.filter((f) => !readme.includes(f));
    expect(missing).toEqual([]);
  });

  it("keeps skills/schem/SKILL.md within 150 lines and documents all 12 MCP tools", () => {
    const skillText = readFileSync(path.join(ROOT, "skills", "schem", "SKILL.md"), "utf8");
    const lineCount = skillText.trimEnd().split(/\r?\n/).length;
    expect(lineCount).toBeLessThanOrEqual(150);

    const expectedTools = [
      "schem_create",
      "schem_edit",
      "schem_check",
      "schem_preview",
      "schem_query",
      "schem_render",
      "schem_undo",
      "schem_describe",
      "schem_fmt",
      "schem_components",
      "schem_component",
      "schem_import",
    ];
    const missingTools = expectedTools.filter((tool) => !skillText.includes(tool));
    expect(missingTools).toEqual([]);
  });

  it("removes legacy web script/folder references and marked from package.json and workflows", () => {
    const pkgPath = path.join(ROOT, "package.json");
    const pkgRaw = readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(pkgRaw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    expect(pkgRaw).not.toMatch(/\bweb:(?:build|serve)\b/);
    expect(pkgRaw).not.toContain("web/");
    expect(pkg.dependencies?.marked).toBeUndefined();
    expect(pkg.devDependencies?.marked).toBeUndefined();
    expect(pkg.optionalDependencies?.marked).toBeUndefined();
    expect(pkg.peerDependencies?.marked).toBeUndefined();

    const workflowsDir = path.join(ROOT, ".github", "workflows");
    const workflowFiles = readdirSync(workflowsDir)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .sort();
    expect(workflowFiles.length).toBeGreaterThan(0);

    for (const file of workflowFiles) {
      const text = readFileSync(path.join(workflowsDir, file), "utf8");
      expect(text, `${file} contains web:build or web:serve`).not.toMatch(/\bweb:(?:build|serve)\b/);
      expect(text, `${file} contains web/`).not.toContain("web/");
    }
  });
});
