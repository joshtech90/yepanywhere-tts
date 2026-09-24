import type { ToolCallItem } from "@yep-anywhere/shared/transcript/items";
import { describe, expect, it } from "vitest";
import { createCockpitToolDisplay } from "./toolDisplay";

function tool(
  overrides: Partial<ToolCallItem> & Pick<ToolCallItem, "toolName">,
): ToolCallItem {
  return {
    type: "tool_call",
    id: "tool-1",
    toolInput: {},
    status: "complete",
    sourceMessages: [],
    ...overrides,
  };
}

describe("Cockpit tool display projection", () => {
  it("projects shell command, output, failure status, and exit code", () => {
    const display = createCockpitToolDisplay(
      tool({
        toolName: "exec_command",
        toolInput: {
          command: ["/bin/bash", "-lc", "printf 'DEMO_FAILURE\\n' >&2; exit 7"],
        },
        status: "error",
        toolResult: {
          content: "Exit code: 7\nDEMO_FAILURE\n",
          isError: true,
          structured: {
            stdout: "",
            stderr: "DEMO_FAILURE\n",
            exitCode: 7,
          },
        },
      }),
    );

    expect(display).toMatchObject({
      displayName: "Bash",
      kind: "shell",
      recognized: true,
      status: "error",
      shell: {
        command: "printf 'DEMO_FAILURE\\n' >&2; exit 7",
        stderr: "DEMO_FAILURE\n",
        exitCode: 7,
      },
    });
  });

  it("projects structured and multi-file diffs with line counts", () => {
    const display = createCockpitToolDisplay(
      tool({
        toolName: "apply_patch",
        toolInput: {
          changes: [
            {
              path: "notes/fern.md",
              unified_diff:
                "@@ -3,1 +3,1 @@\n-Status: queued\n+Status: ready\n",
            },
            {
              path: "notes/moss.md",
              unified_diff: "@@ -1,0 +1,1 @@\n+New sample note\n",
            },
          ],
        },
        toolResult: {
          content: "Updated two files",
          isError: false,
        },
      }),
    );

    expect(display.kind).toBe("files");
    expect(display.files).toHaveLength(2);
    expect(display.files[0]).toMatchObject({
      path: "notes/fern.md",
      additions: 1,
      deletions: 1,
    });
    expect(display.files[1]).toMatchObject({
      path: "notes/moss.md",
      additions: 1,
      deletions: 0,
    });
  });

  it("keeps unknown provider tools visible without interpreting them", () => {
    const display = createCockpitToolDisplay(
      tool({
        toolName: "provider_future_action",
        toolInput: { opaque: "<script>not markup</script>" },
        toolResult: {
          content: "provider-owned result",
          isError: false,
        },
      }),
    );

    expect(display).toMatchObject({
      displayName: "provider_future_action",
      kind: "generic",
      recognized: false,
      shell: null,
      files: [],
    });
    expect(display.rawInput).toContain("<script>not markup</script>");
    expect(display.rawResult).toBe("provider-owned result");
  });

  it("keeps running shell state and bounds opaque raw data", () => {
    const running = createCockpitToolDisplay(
      tool({
        toolName: "Bash",
        toolInput: { command: "sleep 5" },
        status: "pending",
        toolResult: undefined,
      }),
    );
    const opaque = createCockpitToolDisplay(
      tool({
        toolName: "future_tool",
        toolInput: { payload: "x".repeat(13_000) },
      }),
    );

    expect(running).toMatchObject({
      kind: "shell",
      status: "pending",
      shell: {
        command: "sleep 5",
        exitCode: null,
      },
    });
    expect(opaque.rawInput.length).toBeLessThan(12_100);
    expect(opaque.rawInput.endsWith("\n…")).toBe(true);
  });
});
