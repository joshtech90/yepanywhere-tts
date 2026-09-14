import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SessionMetadataProvider } from "../../contexts/SessionMetadataContext";
import { I18nProvider } from "../../i18n";
import { getSourceRuntimeRegistry } from "../../lib/sourceRuntime";
import { LOCAL_CLIENT_SUMMARY_SOURCE_KEY } from "../../lib/clientSummaryStore";
import { WorkflowAssistantOutput } from "../WorkflowAssistantOutput";
import { TextBlock } from "../blocks/TextBlock";

const version = vi.hoisted(() => ({ value: { current: "0.8.2" } }));
vi.mock("../../hooks/useVersion", () => ({
  useRetainedVersionInfo: () => version.value,
}));

const transport = getSourceRuntimeRegistry().getOrCreateSourceRuntime(
  LOCAL_CLIENT_SUMMARY_SOURCE_KEY,
).transport;
const stage = "[publish][prepare]";
const text = `${stage} Read [the report](https://example.com/report).`;

function row(streaming = false, sessionId = "session") {
  return (
    <I18nProvider>
      <MemoryRouter>
        <SessionMetadataProvider
          projectId="project"
          projectPath="/workspace"
          sessionId={sessionId}
        >
          <WorkflowAssistantOutput
            text={text}
            workflow={{
              markers: [
                {
                  start: 0,
                  end: stage.length,
                  prefix: stage,
                  title: "Prepare",
                  kind: "stage",
                },
              ],
            }}
            isStreaming={streaming}
            original={
              <a href="https://example.com/original">Original message</a>
            }
            renderText={(source, html) => (
              <TextBlock text={source} augmentHtml={html} />
            )}
          />
        </SessionMetadataProvider>
      </MemoryRouter>
    </I18nProvider>
  );
}

beforeEach(() => {
  version.value = { current: "0.8.2" };
});
afterEach(() => vi.restoreAllMocks());

it("keeps Markdown links usable before and after original-output disclosure", async () => {
  const fetch = vi.spyOn(transport, "fetch").mockResolvedValue({
    html: ['<p>Read <a href="https://example.com/report">the report</a>.</p>'],
  });
  const view = render(row());
  const link = await screen.findByRole("link", { name: "the report" });
  expect(link.getAttribute("href")).toBe("https://example.com/report");
  expect(view.container.textContent).not.toContain("[the report](");
  expect(screen.queryByText("Original message")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Expand original output" }),
  );
  expect(screen.getByText("Original message")).toBeDefined();
  fireEvent.click(
    screen.getByRole("button", { name: "Collapse original output" }),
  );
  expect(screen.getByRole("link", { name: "the report" })).toBe(link);
  view.rerender(row());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toBe(
    "/projects/project/tool-commentary/render",
  );
  expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({
    texts: [" Read [the report](https://example.com/report)."],
  });
});

it.each(["0.8.0", "0.8.1"])(
  "retains ordinary rich messages on server %s without a request",
  (current) => {
    version.value = { current };
    const fetch = vi.spyOn(transport, "fetch");
    render(row());
    expect(
      screen.getByRole("link", { name: "Original message" }),
    ).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("waits for message completion and retains rich output after rendering failure", async () => {
  const fetch = vi
    .spyOn(transport, "fetch")
    .mockRejectedValue(new Error("unavailable"));
  const view = render(row(true));
  expect(screen.getByText("Original message")).toBeDefined();
  expect(fetch).not.toHaveBeenCalled();
  view.rerender(row());
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(screen.getByText("Original message")).toBeDefined();
  expect(
    screen.queryByRole("button", { name: "Expand original output" }),
  ).toBeNull();
});

it("ignores late rendering from a previous session", async () => {
  const pending: Array<(value: { html: string[] }) => void> = [];
  vi.spyOn(transport, "fetch").mockImplementation(
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const view = render(row());
  view.rerender(row(false, "other-session"));
  await act(async () => pending[0]!({ html: ["<p>Old session</p>"] }));
  expect(screen.queryByText("Old session")).toBeNull();
  expect(screen.getByText("Original message")).toBeDefined();
  await act(async () => pending[1]!({ html: ["<p>New session</p>"] }));
  expect(await screen.findByText("New session")).toBeDefined();
});
