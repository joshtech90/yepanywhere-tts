import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toolRegistry } from "..";
import { displayProviders } from "../__fixtures__/displayProviders";
import { toolDisplayDiagnostics } from "../displayDiagnostics";
import type { DisplayRecord } from "../prepareDisplay";

const context = { isStreaming: false, theme: "dark" as const };
beforeEach(() => {
  toolDisplayDiagnostics.synchronousCatches = 0;
  toolDisplayDiagnostics.renderCatches = 0;
  vi.spyOn(console, "error");
  vi.spyOn(console, "warn");
});
afterEach(() => {
  cleanup();
  expect(toolDisplayDiagnostics).toEqual({
    synchronousCatches: 0,
    renderCatches: 0,
  });
  expect(console.error).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
function mount(tool: string, record: DisplayRecord, inline = false) {
  const prepared = toolRegistry.prepare(tool, record);
  expect(prepared.kind).toBe("rich");
  const view = render(
    displayProviders(
      inline
        ? prepared.renderInline(context)
        : prepared.renderToolResult(context),
    ),
  );
  expect(view.container.querySelector('[data-tool-display="raw"]')).toBeNull();
  return view;
}

// These controls follow the installed Claude SDK declarations and pre-migration
// renderer behavior. They deliberately do not import displayFixtures.
it("keeps search links when native results include commentary strings", () => {
  mount("WebSearch", {
    input: { query: "contracts" },
    status: "complete",
    result: {
      query: "contracts",
      results: [
        "Search commentary",
        {
          content: [
            {
              title: "Contract reference",
              url: "https://example.com/contracts",
            },
          ],
        },
      ],
      durationSeconds: 0.5,
    },
  });
  expect(
    screen
      .getByRole("link", { name: "Contract reference" })
      .getAttribute("href"),
  ).toBe("https://example.com/contracts");
});
it("renders a native PDF without an invented file.type, including standalone path", () => {
  mount("Read", {
    input: undefined,
    status: "complete",
    result: {
      type: "pdf",
      file: {
        filePath: "/tmp/reference.pdf",
        base64: "JVBERi0=",
        originalSize: 1024,
      },
    },
  });
  expect(screen.getByText("reference.pdf")).toBeDefined();
  expect(screen.getByText("PDF")).toBeDefined();
  expect(document.body.textContent).toContain("(1\u202fkb)");
  expect(document.body.textContent).not.toContain("\\u202f");
});
it("keeps images with only original dimensions usable", () => {
  mount("Read", {
    input: { file_path: "/tmp/image.png" },
    status: "complete",
    result: {
      type: "image",
      file: {
        base64: "YQ==",
        type: "image/png",
        dimensions: { originalWidth: 10, originalHeight: 20 },
      },
    },
  });
  expect(screen.getByText("10x20")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Expand image" }));
  expect(screen.getByRole("img").getAttribute("src")).toBe(
    "data:image/png;base64,YQ==",
  );
});
it.each(["success", "not_ready"])(
  "retains TaskOutput %s and local_agent output",
  (retrieval_status) => {
    mount("TaskOutput", {
      input: { task_id: "agent-1" },
      status: "complete",
      result: {
        retrieval_status,
        task: {
          task_id: "agent-1",
          task_type: "local_agent",
          status: "completed",
          description: "Review",
          output: "Agent findings",
        },
      },
    });
    expect(screen.getByText("Agent findings")).toBeDefined();
    expect(screen.getByText("local_agent")).toBeDefined();
  },
);
it.each(["ExitPlanMode", "UpdatePlan"])(
  "renders %s standalone output",
  (tool) => {
    mount(tool, {
      input: undefined,
      status: "complete",
      result:
        tool === "ExitPlanMode"
          ? { plan: "Visible standalone plan" }
          : "Visible standalone plan",
    });
    expect(screen.getByText("Visible standalone plan")).toBeDefined();
  },
);
it.each([
  { error: "Goal unavailable" },
  { content: "Goal unavailable" },
  { error: { detail: "Goal unavailable" } },
])("preserves goal failure details %j", (result) => {
  mount("get_goal", { input: {}, result, status: "error" });
  expect(screen.getByText("Goal unavailable")).toBeDefined();
});
it("preserves declined Edit classification and the proposed diff", () => {
  mount("Edit", {
    input: {
      file_path: "/tmp/file.ts",
      old_string: "before",
      new_string: "after",
      _structuredPatch: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          lines: ["-before", "+after"],
        },
      ],
    },
    result: "User rejected tool use",
    status: "error",
  });
  expect(screen.getByText("Declined")).toBeDefined();
  expect(screen.getByText(/after/)).toBeDefined();
});
it("retains Task failure details in its existing inline disclosure", () => {
  mount(
    "Task",
    {
      input: { prompt: "Review", description: "Review task" },
      result: "Error: agent timed out",
      status: "error",
    },
    true,
  );
  expect(screen.getByText(/agent timed out/)).toBeDefined();
});
it("retains rendered HTML inside Task content", () => {
  mount("Task", {
    input: { prompt: "Review" },
    status: "complete",
    result: {
      status: "completed",
      content: [
        {
          type: "text",
          text: "[Reference](https://example.com)",
          _renderedHtml: '<p><a href="https://example.com">Reference</a></p>',
        },
      ],
    },
  });
  expect(
    screen.getByRole("link", { name: "Reference" }).getAttribute("href"),
  ).toBe("https://example.com");
});
it.each(["name", "id"])(
  "rejects a nested tool call missing %s before mounting",
  (key) => {
    const block = {
      type: "tool_use",
      id: "child",
      name: "Write",
      input: { content: "retained" },
    };
    Reflect.deleteProperty(block, key);
    const prepared = toolRegistry.prepare("Task", {
      input: { prompt: "Review" },
      status: "complete",
      result: { status: "completed", content: [block] },
    });
    expect(prepared.kind).toBe("raw");
    const view = render(displayProviders(prepared.renderToolResult(context)));
    expect(
      view.container.querySelector('[data-tool-display="raw"]'),
    ).not.toBeNull();
    expect(view.container.textContent).toContain("retained");
  },
);

it("retains a not-ready task poll without invented task output or status", () => {
  mount("TaskOutput", {
    input: { task_id: "agent-1" },
    status: "complete",
    result: {
      retrieval_status: "not_ready",
      task: { task_type: "local_agent" },
    },
  });
  expect(screen.getByText(/not_ready/)).toBeDefined();
  expect(screen.getByText("local_agent")).toBeDefined();
  expect(screen.queryByText(/exit /)).toBeNull();
});

it.each(["Edit", "ExitPlanMode", "UpdatePlan"])(
  "inspects an empty standalone %s result instead of rendering nothing",
  (tool) => {
    const prepared = toolRegistry.prepare(tool, {
      input: undefined,
      result: {},
      status: "complete",
    });
    expect(prepared.kind).toBe("raw");
    const view = render(displayProviders(prepared.renderToolResult(context)));
    expect(
      view.container.querySelector('[data-tool-display="raw"]'),
    ).not.toBeNull();
    expect(view.container.textContent).toContain("{}");
  },
);
