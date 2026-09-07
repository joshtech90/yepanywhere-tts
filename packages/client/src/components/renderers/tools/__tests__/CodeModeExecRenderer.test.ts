import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import { I18nProvider } from "../../../../i18n";
import { codeModeExecRenderer } from "../CodeModeExecRenderer";
import { getToolSummary } from "../../../tools/summaries";
import { toolRegistry } from "..";

describe("CodeModeExecRenderer", () => {
  it("renders persisted code-mode text blocks as readable skill content", () => {
    const result = JSON.stringify([
      {
        type: "input_text",
        text: "Script completed\nWall time 0.8 seconds\nOutput:\n",
      },
      {
        type: "input_text",
        text: "---\nname: publish\ndescription: Publish the hosted client.\n---\n\n# Publish YA\n\nRead the deployment instructions.\n",
      },
      {
        type: "input_text",
        text: "# Local Addendum\n\nKeep unrelated work intact.\n",
      },
    ]);
    const { container, getByText } = render(
      createElement(
        I18nProvider,
        null,
        codeModeExecRenderer.renderToolResult(
          result,
          false,
          {
            isStreaming: false,
            theme: "dark",
          },
          {
            source: "",
            calls: [
              {
                toolName: "exec_command",
                input: {
                  cmd: "cat .agents/skills/publish/SKILL.md; git status --short",
                },
              },
            ],
          },
        ),
      ),
    );
    expect(container.textContent).toContain("Skill: publish");
    expect(container.textContent).toContain(
      "# Local Addendum\n\nKeep unrelated work intact.",
    );
    const raw = getByText("Raw execution").closest("details");
    expect(raw?.hasAttribute("open")).toBe(false);
    expect(raw?.textContent).toContain(result);
    const displayedParts = Array.from(container.querySelectorAll("pre"))
      .filter((element) => !raw?.contains(element))
      .map((element) => element.textContent)
      .join("\n");
    expect(displayedParts).not.toContain("input_text");
    expect(displayedParts).not.toContain("\\n");
  });

  it("names skill reads while keeping mixed execution distinct", () => {
    const input = {
      source: "",
      calls: [
        {
          toolName: "exec_command",
          input: {
            cmd: "cat .agents/skills/publish/SKILL.md; git status --short",
          },
        },
        { toolName: "exec_command", input: { cmd: "cat AGENTS.local.md" } },
      ],
    };
    expect(
      getToolSummary(
        "Exec",
        input,
        { content: "ok", isError: false },
        "complete",
      ),
    ).toBe("publish/SKILL.md · 2 commands");
    expect(toolRegistry.getDisplayName("Exec", "complete", input)).toBe("Exec");
    const pure = {
      source: "",
      calls: [
        {
          toolName: "exec_command",
          input: { cmd: "cat '/skills/my skill/SKILL.md'" },
        },
      ],
    };
    expect(toolRegistry.getDisplayName("Exec", "pending", pure)).toBe(
      "Loading skill",
    );
    expect(toolRegistry.getDisplayName("Exec", "complete", pure)).toBe(
      "Skill load",
    );
  });

  it("summarizes grouped shell calls without showing generic done", () => {
    const summary = getToolSummary(
      "Exec",
      {
        source: "",
        calls: [
          { toolName: "exec_command", input: { cmd: "pnpm lint" } },
          { toolName: "exec_command", input: { cmd: "pnpm typecheck" } },
        ],
      },
      { content: "ok", isError: false },
      "complete",
    );

    expect(summary).toBe("2 commands");
  });

  it.each([
    "echo cat .agents/skills/publish/SKILL.md",
    "rg 'cat .agents/skills/publish/SKILL.md' log.txt",
    'cat "$SKILLS/publish/SKILL.md"',
    "cat .agents/skills/publish/SKILL.md.backup",
  ])("does not infer a skill read from %s", (cmd) => {
    const input = {
      calls: [{ toolName: "exec_command", input: { cmd } }],
      source: "",
    };
    expect(toolRegistry.getDisplayName("Exec", "complete", input)).toBe("Exec");
    expect(getToolSummary("Exec", input, undefined, "pending")).toBe(
      "1 command",
    );
  });

  it.each([false, true])(
    "unwraps command records (allSettled=%s) without hiding failures",
    (settled) => {
      const record = {
        chunk_id: "abc",
        output: "permission denied\n",
        exit_code: 1,
        wall_time_seconds: 0.4,
      };
      const result = [
        {
          type: "input_text",
          text: JSON.stringify(
            settled ? { status: "fulfilled", value: record } : record,
          ),
        },
      ];
      const { getByText } = render(
        createElement(
          I18nProvider,
          null,
          codeModeExecRenderer.renderToolResult(result, false, {
            isStreaming: false,
            theme: "dark",
          }),
        ),
      );
      expect(getByText("permission denied").tagName).toBe("PRE");
      expect(getByText("Exit code: 1 · 0.4s")).toBeDefined();
    },
  );

  it.each([
    '[{"type":"input_text","text":"truncated',
    [
      { type: "input_text", text: "hello" },
      { type: "image", image_url: "data:image/png;base64,abc" },
    ],
    [{ type: "input_text", text: 4 }],
  ])("preserves unrecognized or mixed output", (result) => {
    const { container } = render(
      createElement(
        I18nProvider,
        null,
        codeModeExecRenderer.renderToolResult(result, true, {
          isStreaming: false,
          theme: "dark",
        }),
      ),
    );
    expect(container.textContent).toBe(
      typeof result === "string" ? result : JSON.stringify(result, null, 2),
    );
  });
});
