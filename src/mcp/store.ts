// File writes for the CLI and MCP server (SPEC 11.2, 11.3).
// a replace is a temp file in the same folder, then a rename, so the original is never left
// half-written. OneDrive, an editor or antivirus can block that rename for a moment on Windows.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, constants } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { isLink, resolvePath, showPath, type Roots } from "./roots.js";

/** Older copies kept per file in .schem-history/ next to it (SPEC 11.3). */
const HISTORY = 20;
const LOCK_STALE_MS = 60_000;

function history(file: string, create: boolean): { dir: string; numbers: number[] } {
  const parent = join(dirname(file), ".schem-history"), dir = join(parent, basename(file));
  for (const folder of [parent, dir]) {
    if (existsSync(folder) && isLink(folder)) throw new Error(`${showPath(folder)} is a symlink or junction.`);
    if (create) mkdirSync(folder, { recursive: true });
  }
  const numbers = (existsSync(dir) ? readdirSync(dir) : [])
    .map((f) => /^(\d+)\.schem\.json$/.exec(f)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  return { dir, numbers };
}

/** Save atomically and keep the previous version under .schem-history. The caller holds the lock. */
export function replaceWithHistory(file: string, data: string): void {
  const { dir, numbers } = history(file, true);
  const backup = join(dir, `${(numbers.at(-1) ?? 0) + 1}.schem.json`);
  if (isLink(file)) throw new Error(`${showPath(file)} is a symlink or junction.`);
  copyFileSync(file, backup, constants.COPYFILE_EXCL);
  try { replaceFile(file, data); }
  catch (error) { rmSync(backup); throw error; }
  for (const n of numbers.slice(0, Math.max(0, numbers.length + 1 - HISTORY))) rmSync(join(dir, `${n}.schem.json`));
}

/** Restore and consume the newest snapshot. The caller holds the project lock. */
export function restoreLatest<T>(file: string, verify: (source: Buffer) => T): T {
  const { dir, numbers } = history(file, false);
  const last = numbers.at(-1);
  if (last === undefined) throw new Error("There is no saved version to undo.");
  const path = join(dir, `${last}.schem.json`);
  if (isLink(path)) throw new Error(`${showPath(path)} is a symlink or junction.`);
  const bytes = readFileSync(path), result = verify(bytes);
  replaceFile(file, bytes);
  rmSync(path);
  return result;
}

/**
 * Replace a file through a temporary file and a rename (SPEC 11.2). Refuses when the target is
 * itself a symlink or junction. Re-checks the folder after the temp file is written.
 */
export function replaceFile(file: string, data: string | Buffer): void {
  if (isLink(file)) throw new Error(`${showPath(file)} is a symlink or junction. schem will not replace it.`);
  const folder = dirname(file);
  const before = realFolder(folder);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data, { flag: "wx" });
  try {
    const after = realFolder(folder);
    if (after !== before) throw new Error(`the folder of ${showPath(file)} changed while it was being written.`);
    if (isLink(file)) throw new Error(`${showPath(file)} is a symlink or junction. schem will not replace it.`);
    for (let attempt = 1; ; attempt++) {
      try {
        renameSync(tmp, file);
        return;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (attempt >= 10 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * attempt);
      }
    }
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

/** Create a file only when it does not exist (exclusive-create). */
export function exclusiveCreate(file: string, data: string | Buffer): void {
  try {
    writeFileSync(file, data, { flag: "wx" });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw new Error(`${showPath(file)} already exists. schem will not replace it.`);
    throw e;
  }
}

/** Resolve a single export before acquiring its write lock. */
export function writeOutput(roots: Roots, input: string, protectedFile: string, data: string | Buffer, overwrite: boolean): string {
  const dest = resolvePath(roots, input, overwrite ? "overwrite" : "create");
  if (!dest.ok) throw new Error(dest.message);
  if (relative(dest.real, protectedFile) === "") throw new Error("The output path is the project file.");
  withLock(dest.real, () => {
    if (overwrite && existsSync(dest.real)) replaceFile(dest.real, data);
    else exclusiveCreate(dest.real, data);
  });
  return dest.real;
}

export class WriteConflict extends Error {}

/**
 * One writer at a time for `file` (SPEC 11.2). The lock is `<file>.lock`, created exclusively
 * and removed when `fn` finishes. A lock older than 60 seconds is stale and is taken over.
 */
export function withLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`;
  let held = false;
  for (let attempt = 0; attempt < 3 && !held; attempt++) {
    try {
      writeFileSync(lock, `${process.pid}\n`, { flag: "wx" });
      held = true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw e;
      let stale = false;
      try {
        stale = Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      if (!stale) {
        throw new WriteConflict(`another writer holds ${showPath(lock)}. It is removed when that write finishes, or it can be taken over after 60 seconds.`);
      }
      rmSync(lock, { force: true });
    }
  }
  if (!held) throw new Error(`could not lock ${showPath(file)}.`);
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

function realFolder(folder: string): string {
  return realpathSync(folder);
}
