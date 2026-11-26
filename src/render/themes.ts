// Rendering themes (SPEC 12.1): colour palettes for SVG and PNG output.

export type ThemeName = "clean" | "dark" | "blueprint" | "textbook" | "mono-print";

export interface ThemeDef {
  readonly id: ThemeName;
  readonly name: string;
  readonly description: string;
  readonly background: string;
  readonly stroke: string;
  readonly fill: string;
  readonly text: string;
}

export const THEME_NAMES: readonly ThemeName[] = [
  "clean",
  "dark",
  "blueprint",
  "textbook",
  "mono-print",
] as const;

export const THEMES: Readonly<Record<ThemeName, ThemeDef>> = {
  clean: {
    id: "clean",
    name: "Clean",
    description: "Black ink on a white background; the default publication theme.",
    background: "#ffffff",
    stroke: "#000000",
    fill: "#000000",
    text: "#000000",
  },
  dark: {
    id: "dark",
    name: "Dark",
    description: "High-contrast light slate ink on a deep slate background for dark pages and slides.",
    background: "#0f172a",
    stroke: "#e2e8f0",
    fill: "#e2e8f0",
    text: "#f8fafc",
  },
  blueprint: {
    id: "blueprint",
    name: "Blueprint",
    description: "Crisp pale blue-white ink on deep blueprint navy.",
    background: "#0b2545",
    stroke: "#eef6ff",
    fill: "#eef6ff",
    text: "#ffffff",
  },
  textbook: {
    id: "textbook",
    name: "Textbook",
    description: "Deep charcoal ink on warm off-white paper for long-form reading and print.",
    background: "#faf7f0",
    stroke: "#1c1917",
    fill: "#1c1917",
    text: "#1c1917",
  },
  "mono-print": {
    id: "mono-print",
    name: "Mono Print",
    description: "Pure black ink on pure white for monochrome laser and offset printing.",
    background: "#ffffff",
    stroke: "#000000",
    fill: "#000000",
    text: "#000000",
  },
};

export function resolveTheme(name?: string): ThemeDef {
  const key = name ?? "clean";
  if (Object.prototype.hasOwnProperty.call(THEMES, key)) {
    return THEMES[key as ThemeName];
  }
  throw new Error(`Unknown theme "${key}". Valid themes: ${THEME_NAMES.join(", ")}.`);
}
