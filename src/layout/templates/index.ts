// Pattern templates (SPEC 9.4): data in ./library.ts, engine in ./engine.ts.

export { TEMPLATES } from "./library.js";
export {
  apartPairs, isBoundary, linkConstraints, matchTemplates, slotOf, solveInterior, templateLabel, templateOrient, templateRanks, templateSides, trunkRuns,
  type Geo, type Interior, type Region, type TemplateGraph,
} from "./engine.js";
export type { Template } from "./types.js";
