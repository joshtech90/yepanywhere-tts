import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { skillRenderer } from "../SkillRenderer";

const renderContext = {
  isStreaming: false,
  theme: "dark" as const,
};

function prepared(input: unknown, result: unknown, isError = false) {
  return skillRenderer.prepare({
    input,
    result,
    status: isError ? "error" : "complete",
    isError,
  });
}

describe("SkillRenderer", () => {
  it("names the skill and its arguments instead of falling back to raw data", () => {
    const display = prepared(
      { skill: "publish", args: "push origin and graehl" },
      { success: true, commandName: "publish" },
    );

    expect(display.kind).toBe("rich");
    const { container } = render(
      <div>
        {display.renderToolUse(renderContext)}
        {display.renderToolResult(renderContext)}
      </div>,
    );
    expect(container.textContent).toContain("publish");
    expect(container.textContent).toContain("push origin and graehl");
    expect(container.textContent).toContain("Loaded");
    // A complete row renders only the result, so it carries the arguments too.
    const { container: resultOnly } = render(
      display.renderToolResult(renderContext),
    );
    expect(resultOnly.textContent).toContain("push origin and graehl");
    expect(display.getUseSummary()).toBe("publish push origin and graehl");
    expect(display.getResultSummary()).toBe("publish");
  });

  it("reports a skill that did not load", () => {
    const display = prepared({ skill: "publish" }, { success: false });

    render(display.renderToolResult(renderContext));
    expect(screen.getByText(/did not load/).textContent).toBe(
      "publish did not load",
    );
    expect(display.getResultSummary()).toBe("Not loaded");
  });

  it("keeps the checked skill name when the result is plain provider text", () => {
    const display = prepared({ skill: "librarian" }, "Launching skill");

    expect(display.kind).toBe("partial");
    const { container } = render(display.renderToolUse(renderContext));
    expect(container.textContent).toContain("librarian");
  });
});
