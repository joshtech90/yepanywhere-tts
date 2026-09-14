/**
 * Mermaid diagrams for ```` ```mermaid ```` fences.
 *
 * Mermaid lays diagrams out against a live DOM, so this cannot run in the
 * server augment generator. The package itself is a dynamic import, so a
 * session with no diagrams never downloads it.
 */

import type { CodeFenceRenderer } from "./registry";

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
};

/** Mermaid's own theme names for YA's resolved light/dark appearance. */
const MERMAID_THEME = { dark: "dark", light: "neutral" } as const;

type Appearance = keyof typeof MERMAID_THEME;

let loadPromise: Promise<MermaidApi> | null = null;
let configuredAppearance: Appearance | null = null;
let idCounter = 0;

/**
 * YA's resolved light/dark appearance. `data-theme="auto"` follows the OS, and
 * `verydark` is a darker variant of dark rather than a third case.
 */
export function resolveAppearance(doc: Document = document): Appearance {
  const theme = doc.documentElement.getAttribute("data-theme");
  if (theme === "dark" || theme === "verydark") {
    return "dark";
  }
  if (theme === "light") {
    return "light";
  }
  return doc.defaultView?.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

async function loadMermaid(): Promise<MermaidApi> {
  if (!loadPromise) {
    loadPromise = import("mermaid").then(
      (module) => module.default as unknown as MermaidApi,
    );
  }
  return loadPromise;
}

/**
 * Mermaid holds its theme in global config, so re-apply it whenever YA's
 * appearance has changed since the last diagram. The render cache is keyed on
 * appearance too, so a theme switch re-renders rather than reusing stale SVG.
 */
function configure(mermaid: MermaidApi, appearance: Appearance): void {
  if (configuredAppearance === appearance) {
    return;
  }
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: MERMAID_THEME[appearance],
  });
  configuredAppearance = appearance;
}

/**
 * A failed `mermaid.render` can leave behind the detached measurement element
 * it appends to the document while laying a diagram out.
 */
function removeMeasurementLeftovers(id: string): void {
  for (const stray of document.querySelectorAll(`#${id}, #d${id}`)) {
    stray.remove();
  }
}

export const mermaidRenderer: CodeFenceRenderer = {
  language: "mermaid",
  renderedNoun: "diagram",
  async render(source: string): Promise<string | null> {
    const mermaid = await loadMermaid();
    configure(mermaid, resolveAppearance());

    const id = `ya-mermaid-${++idCounter}`;
    try {
      const { svg } = await mermaid.render(id, source);
      return svg;
    } catch {
      // Incomplete or invalid diagram source. The caller keeps showing the
      // highlighted source, and a streaming block tries again as it grows.
      return null;
    } finally {
      removeMeasurementLeftovers(id);
    }
  },
};
