import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { globRenderer } from "../GlobRenderer";
import { readRenderer } from "../ReadRenderer";
import { todoWriteRenderer } from "../TodoWriteRenderer";
import { recordFromLegacyArgs } from "../prepareDisplay";
import { PlainFailureSchema } from "../displayContracts";

vi.mock("../../../../contexts/SchemaValidationContext", () => ({
  useSchemaValidationContext: () => ({
    enabled: false,
    reportValidationError: vi.fn(),
    isToolIgnored: vi.fn(() => false),
  }),
}));

const renderContext = {
  isStreaming: false,
  theme: "dark" as const,
};

const failed = (input: unknown, result: unknown) =>
  recordFromLegacyArgs(input, result, true, "error");

describe("plain failure contract", () => {
  it("reads the message from either shape a provider sends", () => {
    expect(PlainFailureSchema.parse("EACCES: permission denied")).toEqual({
      content: "EACCES: permission denied",
    });
    expect(PlainFailureSchema.parse({ content: "no such file" })).toEqual({
      content: "no such file",
    });
    expect(PlainFailureSchema.safeParse({ filenames: [] }).success).toBe(false);
  });

  it("renders a rejected Glob as its own error, not a raw dump", () => {
    const prepared = globRenderer.prepare(
      failed({ pattern: "**/*.ts" }, { content: "EACCES: permission denied" }),
    );

    expect(prepared.kind).toBe("rich");
    expect(prepared.getResultSummary()).toBe("Error");

    render(<div>{prepared.renderToolResult(renderContext)}</div>);
    expect(screen.getByText("EACCES: permission denied")).toBeDefined();
  });

  it("accepts a bare string rejection", () => {
    const prepared = todoWriteRenderer.prepare(
      failed({ todos: [] }, "Todo list is locked"),
    );

    expect(prepared.kind).toBe("rich");
    render(<div>{prepared.renderToolResult(renderContext)}</div>);
    expect(screen.getByText("Todo list is locked")).toBeDefined();
  });

  it("names the file a rejected Read was reading", () => {
    const prepared = readRenderer.prepare(
      failed({ file_path: "/tmp/missing.txt" }, "ENOENT: no such file"),
    );

    expect(prepared.getResultSummary()).toBe("missing.txt");
    render(<div>{prepared.renderToolResult(renderContext)}</div>);
    expect(screen.getByText("ENOENT: no such file")).toBeDefined();
  });

  it("keeps the raw display for a rejection of neither shape", () => {
    const prepared = globRenderer.prepare(
      failed({ pattern: "**/*.ts" }, { unexpected: ["shape"] }),
    );

    expect(prepared.kind).toBe("raw");
    expect(prepared.reason).toBe("result");
  });
});
