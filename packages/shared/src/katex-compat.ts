/**
 * KaTeX compatibility for TeX found in paper text.
 *
 * Measured over 394 extracted research papers (38,871 expressions, 2026-09-30),
 * KaTeX 0.18 rejected these standard LaTeX and common-package commands. Each
 * macro keeps the content and drops only presentation KaTeX cannot draw, such
 * as small caps. Author-defined macros stay unrendered: their definitions live
 * only in each paper's preamble.
 */
const PAPER_KATEX_MACROS: Readonly<Record<string, string>> = Object.freeze({
  // No small-caps font in KaTeX (KaTeX#471); keep the text upright.
  "\\textsc": "\\text{#1}",
  "\\mbox": "\\text{#1}",
  // bbm and dsfont blackboard bold.
  "\\mathbbm": "\\mathbb{#1}",
  "\\mathds": "\\mathbb{#1}",
  // LaTeX's \O is the letter Ø.
  "\\O": "\\text{Ø}",
  "\\textsubscript": "_{\\text{#1}}",
  // nicefrac: slanted fraction.
  "\\nicefrac": "{}^{#1}\\!/\\!_{#2}",
});

/**
 * A fresh macro table. KaTeX writes `\gdef` definitions into the object it is
 * given, so each render (or each document, for a renderer that copies the
 * table per document) needs its own copy.
 */
export function paperKatexMacros(): Record<string, string> {
  return { ...PAPER_KATEX_MACROS };
}

const COLOR_WITH_MODEL =
  /\\(color|textcolor|colorbox|pagecolor)\s*\[\s*([A-Za-z]+)\s*\]\s*\{([^{}]*)\}/g;

function hexByte(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0");
}

function modelColorToHex(model: string, spec: string): string | null {
  const parts = spec.split(",").map((part) => part.trim());
  const numbers = parts.map(Number);
  const allNumeric = numbers.every((value) => Number.isFinite(value));
  switch (model) {
    case "rgb":
      return parts.length === 3 && allNumeric
        ? `#${numbers.map((value) => hexByte(value * 255)).join("")}`
        : null;
    case "RGB":
      return parts.length === 3 && allNumeric
        ? `#${numbers.map(hexByte).join("")}`
        : null;
    case "HTML":
      return /^[0-9A-Fa-f]{6}$/.test(spec.trim()) ? `#${spec.trim()}` : null;
    case "gray": {
      if (parts.length !== 1 || !allNumeric) return null;
      const byte = hexByte((numbers[0] ?? 0) * 255);
      return `#${byte}${byte}${byte}`;
    }
    case "cmyk": {
      if (parts.length !== 4 || !allNumeric) return null;
      const [c = 0, m = 0, y = 0, k = 0] = numbers;
      return `#${[c, m, y]
        .map((channel) => hexByte(255 * (1 - channel) * (1 - k)))
        .join("")}`;
    }
    default:
      return null;
  }
}

/**
 * Rewrite xcolor's `\color[model]{spec}` (and `\textcolor`, `\colorbox`) into
 * the one-argument hex form KaTeX accepts. An unknown model is left as is.
 * `\pagecolor` has no inline meaning and is dropped with its argument.
 */
export function normalizeTexForKatex(tex: string): string {
  if (!tex.includes("[")) return tex;
  return tex.replace(COLOR_WITH_MODEL, (whole, command, model, spec) => {
    if (command === "pagecolor") return "";
    const hex = modelColorToHex(model, spec);
    return hex ? `\\${command}{${hex}}` : whole;
  });
}
