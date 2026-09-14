import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { I18nProvider } from "../../../../i18n";
import { defineTool, toolDisplayDiagnostics } from "../defineTool";
import { toolRegistry } from "..";
const context = { isStreaming: false, theme: "dark" as const };
afterEach(() => cleanup());
it("contains a deliberately throwing render body, preserves neighbors, and retries a corrected record", () => {
  const error = new Error("intentional render failure");
  const onCaughtError = vi.fn();
  function Body({ text }: { text: string }) {
    if (text === "broken") throw error;
    return <p>{text}</p>;
  }
  const definition = defineTool(
    {
      input: z.object({ text: z.string() }),
      result: z.string(),
      variants: ["text"],
      standaloneResult: false,
    },
    {
      tool: "ExceptionProbe",
      renderToolUse: (input) => <Body text={input.text} />,
      renderToolResult: (result) => <p>{result}</p>,
    },
  );
  const prior = toolDisplayDiagnostics.renderCatches;
  const broken = definition.prepare({
    input: { text: "broken" },
    status: "pending",
  });
  const mounted = render(
    <I18nProvider>
      {broken.renderToolUse(context)}
      <button type="button">Neighbor</button>
    </I18nProvider>,
    { onCaughtError },
  );
  expect(onCaughtError).toHaveBeenCalledTimes(1);
  expect(onCaughtError.mock.calls[0]?.[0]).toBe(error);
  expect(toolDisplayDiagnostics.renderCatches).toBe(prior + 1);
  expect(mounted.getByRole("button", { name: "Neighbor" })).toBeDefined();
  expect(
    mounted.container.querySelector('[data-tool-display="raw"]'),
  ).not.toBeNull();
  const corrected = definition.prepare({
    input: { text: "corrected" },
    status: "complete",
  });
  mounted.rerender(
    <I18nProvider>
      {corrected.renderToolUse(context)}
      <button type="button">Neighbor</button>
    </I18nProvider>,
  );
  expect(mounted.getByText("corrected")).toBeDefined();
  expect(
    mounted.container.querySelector('[data-tool-display="raw"]'),
  ).toBeNull();
});
it("instruments synchronous summary recovery instead of treating it as success", () => {
  const definition = defineTool(
    {
      input: z.object({ text: z.string() }),
      result: z.string(),
      variants: ["text"],
      standaloneResult: false,
    },
    {
      tool: "SummaryProbe",
      renderToolUse: () => null,
      renderToolResult: () => null,
      getUseSummary: () => {
        throw new Error("intentional summary failure");
      },
    },
  );
  const prior = toolDisplayDiagnostics.synchronousCatches;
  expect(
    definition
      .prepare({ input: { text: "valid" }, status: "pending" })
      .getUseSummary(),
  ).toBeUndefined();
  expect(toolDisplayDiagnostics.synchronousCatches).toBe(prior + 1);
});
it("protects aliases and unknown tools without requiring a registration", () => {
  for (const name of [
    "apply_patch",
    "Agent",
    "view_image",
    "FutureProviderTool",
  ]) {
    const prepared = toolRegistry.prepare(name, {
      input: { unexpected: [null] },
      result: "rejected",
      status: "error",
    });
    const mounted = render(
      <I18nProvider>{prepared.renderToolResult(context)}</I18nProvider>,
    );
    expect(
      mounted.container.querySelector('[data-tool-display="raw"]'),
    ).not.toBeNull();
    expect(mounted.getByText("rejected")).toBeDefined();
    expect(mounted.getByText(name)).toBeDefined();
    mounted.unmount();
  }
});
