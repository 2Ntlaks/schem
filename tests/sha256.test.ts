// src/core/sha256.ts against node:crypto: the engine's tokens and font id must not change.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256 } from "../src/core/sha256.js";

const node = (x: string | Uint8Array) => createHash("sha256").update(x).digest("hex");

describe("sha256", () => {
  it("matches node:crypto on the standard vectors and around the padding boundaries", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    for (const n of [1, 55, 56, 57, 63, 64, 65, 119, 120, 1000]) expect(sha256("x".repeat(n)), `length ${n}`).toBe(node("x".repeat(n)));
  });

  it("matches node:crypto on non-ASCII text and on bytes", () => {
    for (const s of ["Ω µF 4.7 kΩ", "日本語", "\u{1F600}"]) expect(sha256(s)).toBe(node(s));
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 7919) & 0xff);
    expect(sha256(bytes)).toBe(node(bytes));
  });
});
