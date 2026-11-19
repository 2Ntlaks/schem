// Where the server may read and write (SPEC 11.2). These checks are a guardrail against a
// confused agent, not a security sandbox: the process is one the user chose to run.

import { existsSync, lstatSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Real paths of the folders this server may touch. */
export interface Roots {
  real: string[];
}

export function showPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** True when `target` is `root` or a file inside it. A sibling such as `root-other` does not count. */
export function insideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function contained(roots: Roots, real: string): boolean {
  return roots.real.some((root) => insideRoot(root, real));
}

/** A symlink, or a Windows junction (readlink succeeds on both). */
export function isLink(p: string): boolean {
  if (lstatSync(p).isSymbolicLink()) return true;
  try {
    readlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Resolve the configured root folders. Throws when one is missing or is not a folder. */
export function openRoots(dirs: string[]): Roots {
  if (dirs.length === 0) throw new Error("no root folder was given.");
  const real: string[] = [];
  for (const dir of dirs) {
    const abs = resolve(dir);
    if (!existsSync(abs)) throw new Error(`root folder does not exist: ${showPath(abs)}`);
    let found: string;
    try {
      found = realpathSync(abs);
    } catch (e) {
      throw new Error(`cannot resolve root ${showPath(abs)}: ${(e as Error).message}`);
    }
    if (!statSync(found).isDirectory()) throw new Error(`root is not a folder: ${showPath(found)}`);
    if (!real.includes(found)) real.push(found);
  }
  return { real };
}

export type Resolved = { ok: true; real: string } | { ok: false; message: string };

/**
 * Resolve a tool path against the roots.
 * `read` requires a file that already exists. `create` requires one that does not.
 * `overwrite` allows either, and refuses when the named path is itself a symlink or junction.
 * Existing paths are realpath'd (symlinks and junctions followed) and then checked.
 * A new file is checked through its existing parent folder.
 */
export function resolvePath(roots: Roots, input: string, mode: "read" | "create" | "overwrite"): Resolved {
  if (input.trim() === "") return { ok: false, message: "path is missing." };
  const abs = resolve(input);
  let linked = false;
  try {
    linked = isLink(abs);
  } catch {
    linked = false;
  }
  if (linked && mode !== "read") {
    return { ok: false, message: `${showPath(abs)} is a symlink or junction. schem will not replace it.` };
  }
  if (existsSync(abs)) {
    let real: string;
    try {
      real = realpathSync(abs);
    } catch (e) {
      return { ok: false, message: `cannot resolve ${showPath(abs)}: ${(e as Error).message}` };
    }
    if (!contained(roots, real)) {
      return { ok: false, message: `${showPath(abs)} is outside the configured roots. It resolves to ${showPath(real)}.` };
    }
    if (mode === "create") return { ok: false, message: `${showPath(real)} already exists. schem does not replace an existing file here.` };
    if (statSync(real).isDirectory()) return { ok: false, message: `${showPath(real)} is a folder, not a file.` };
    return { ok: true, real };
  }
  if (mode === "read") return { ok: false, message: `no such file: ${showPath(abs)}.` };
  const parent = dirname(abs);
  if (!existsSync(parent)) return { ok: false, message: `the folder ${showPath(parent)} does not exist.` };
  let realParent: string;
  try {
    realParent = realpathSync(parent);
  } catch (e) {
    return { ok: false, message: `cannot resolve ${showPath(parent)}: ${(e as Error).message}` };
  }
  const real = join(realParent, basename(abs));
  if (!contained(roots, real)) {
    return { ok: false, message: `${showPath(abs)} is outside the configured roots. Its folder resolves to ${showPath(realParent)}.` };
  }
  return { ok: true, real };
}
