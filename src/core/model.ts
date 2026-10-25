// Circuit data model (SPEC 6.2-6.3).

export type Role = "power_in" | "power_out" | "ground" | "input" | "output" | "bidir" | "passive" | "nc";
export type NetKind = "signal" | "power" | "ground";

export interface PinDef {
  number: string;
  name: string;
  role: Role;
  aliases?: string[];
  group?: string;
  iface?: string[];
  chain?: "in" | "out";
  /** Preferred representative of its group (a module's `representatives`, SPEC 6.2 and 7.3, rev C.3). */
  representative?: boolean;
}

export interface Part { id: string; type: string; props?: Record<string, string>; pins?: PinDef[] }

export interface Net {
  id: string;
  name?: string;
  kind?: NetKind;
  domain?: string | null;
  endpoints: string[];
}

export interface Circuit { parts: Part[]; nets: Net[]; nc?: string[] }

/** Logical pin inventory per part id. In the engine this comes from the symbol assets. */
export type PinDefs = Record<string, PinDef[]>;

export interface Issue { code: string; message: string; at?: string }

export class CircuitError extends Error {
  constructor(public issues: Issue[]) { super(issues.map((i) => `${i.code} ${i.message}`).join("\n")); }
}

/** A resolved endpoint. `group` endpoints are logical (SPEC 6.2). */
export type Endpoint =
  | { kind: "terminal"; part: string; number: string }
  | { kind: "group"; part: string; group: string };

export function canonical(e: Endpoint): string {
  return e.kind === "terminal" ? `${e.part}[${e.number}]` : `${e.part}{${e.group}}`;
}

const POWER_NAME = /^(\+?\d+(\.\d+)?V\d*|\d+V\d+|VCC|VDD|VIN|VBAT|V\+|VPP|VBUS|PWR)$/i;
const GROUND_NAME = /^(GND|AGND|DGND|PGND|VSS|0V|GROUND)$/i;

/** SPEC 6.3: explicit kind wins, else name-based default, else signal. */
export function netKind(n: Net): NetKind {
  if (n.kind) return n.kind;
  if (n.name && GROUND_NAME.test(n.name)) return "ground";
  if (n.name && POWER_NAME.test(n.name)) return "power";
  return "signal";
}
