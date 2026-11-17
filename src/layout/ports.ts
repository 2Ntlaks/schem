// Which power and ground nets are drawn with supply symbols (SPEC 9.2 step 3). One rule, used by
// the layout and by the edit path (which parts an edit affects depends on it).

import { isNegativeSupply, netKind, type Net } from "../core/model.js";
import { BUILTIN } from "../symbols/library.js";

/** The side of the signal path a rail belongs on (SPEC 9.1 rule 7). */
export function railDirection(n: Net): "up" | "down" | undefined {
  const kind = netKind(n);
  if (kind === "ground" || isNegativeSupply(n)) return "down";
  return kind === "power" ? "up" : undefined;
}

/**
 * A named power or ground net is drawn with supply or ground symbols, one at each pin, unless it
 * is a two-pin loop through a source: a battery wired straight to one part is clearer as a wire.
 * `endpoints` are the net's distinct canonical endpoints ("R1[1]", "U1{GND}").
 */
export function drawnAsPorts(n: Net, endpoints: readonly string[], typeOf: (part: string) => string | undefined): boolean {
  const k = netKind(n);
  if ((k !== "power" && k !== "ground") || n.name === undefined) return false;
  if (endpoints.length !== 2) return endpoints.length > 0;
  return !endpoints.some((e) => BUILTIN[typeOf(e.slice(0, e.search(/[[{]/))) ?? ""]?.kind === "source");
}
