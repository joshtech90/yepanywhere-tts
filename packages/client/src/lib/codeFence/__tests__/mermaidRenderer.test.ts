import { beforeEach, describe, expect, it, vi } from "vitest";
import { UI_KEYS } from "../../storageKeys";
import { mermaidRenderer } from "../mermaidRenderer";

const initialize = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: (config: Record<string, unknown>) => initialize(config),
    render: async (_id: string, source: string) => ({
      svg: `<svg aria-label="diagram">${source}</svg>`,
    }),
  },
}));

/**
 * The two cases resolve to different appearances on purpose: the renderer
 * re-configures Mermaid only when the appearance has changed since the last
 * diagram.
 */
describe("mermaidRenderer", () => {
  beforeEach(() => {
    initialize.mockClear();
    // The theme the page is displaying is the stored preference, so a diagram
    // must follow it whether or not the attribute projecting it is present.
    document.documentElement.removeAttribute("data-theme");
  });

  it("draws a dark diagram under the very dark theme", async () => {
    localStorage.setItem(UI_KEYS.theme, "verydark");

    await mermaidRenderer.render("graph TD\nA --> B");

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "dark" }),
    );
  });

  it("draws a light diagram under the light theme", async () => {
    localStorage.setItem(UI_KEYS.theme, "light");

    await mermaidRenderer.render("graph TD\nA --> B");

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "neutral" }),
    );
  });
});
