import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitToolCall } from "./CockpitToolCall";
import type { CockpitToolEntry } from "./core/sessionDetail";

function entry(
  overrides: Partial<CockpitToolEntry["tool"]> = {},
): CockpitToolEntry {
  return {
    kind: "tool",
    key: "local-tool-1",
    timestamp: "2026-09-24T09:00:00.000Z",
    tool: {
      displayName: "Edit",
      files: [
        {
          path: "notes/fern.md",
          additions: 1,
          deletions: 1,
          truncated: false,
          lines: [
            { kind: "hunk", text: "@@ -3 +3 @@" },
            {
              kind: "deletion",
              text: "Status: queued",
              oldLine: 3,
            },
            {
              kind: "addition",
              text: "Status: ready",
              newLine: 3,
            },
          ],
        },
        {
          path: "notes/moss.md",
          additions: 1,
          deletions: 0,
          truncated: false,
          lines: [
            {
              kind: "addition",
              text: "New sample note",
              newLine: 1,
            },
          ],
        },
      ],
      kind: "files",
      rawInput: "",
      rawResult: "",
      recognized: true,
      shell: null,
      status: "complete",
      summary: "notes/fern.md +1",
      ...overrides,
    },
  };
}

function renderTool(toolEntry = entry()) {
  return render(
    <I18nProvider>
      <CockpitToolCall entry={toolEntry} time="09:00" />
    </I18nProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  localStorage.setItem(UI_KEYS.locale, "en");
});

describe("Cockpit tool call", () => {
  it("expands a compact row and navigates a multi-file diff", () => {
    renderTool();

    const toggle = screen.getByLabelText("Show or hide details for Edit");
    expect(toggle.closest("details")?.hasAttribute("open")).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.closest("details")?.hasAttribute("open")).toBe(true);
    expect(screen.getByText("Status: ready")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "notes/moss.md" }));
    expect(screen.getByText("New sample note")).toBeTruthy();
    expect(screen.queryByText("Status: ready")).toBeNull();
  });

  it("labels unknown provider data and renders it as text", () => {
    renderTool(
      entry({
        displayName: "provider_future_action",
        files: [],
        kind: "generic",
        rawInput: '{\n  "opaque": "<script>not markup</script>"\n}',
        rawResult: "provider-owned result",
        recognized: false,
        summary: "provider_future_action",
      }),
    );

    fireEvent.click(
      screen.getByLabelText(
        "Show or hide details for provider_future_action",
      ),
    );
    expect(
      screen.getByText(
        "This provider tool is not recognized. Its data is shown as text without interpretation.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/<script>not markup<\/script>/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy tool input" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy tool result" }),
    ).toBeTruthy();
  });

  it("shows failed shell metadata and long output only after expansion", () => {
    const longOutput = Array.from(
      { length: 80 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    renderTool(
      entry({
        displayName: "Bash",
        files: [],
        kind: "shell",
        rawInput: "",
        rawResult: "",
        recognized: true,
        shell: {
          command: "run-demo-check",
          stdout: longOutput,
          stderr: "DEMO_FAILURE",
          exitCode: 7,
          interrupted: false,
        },
        status: "error",
        summary: "run-demo-check",
      }),
    );

    expect(screen.getByText("Failed")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Show or hide details for Bash"));
    expect(screen.getByText("Exit 7")).toBeTruthy();
    expect(screen.getByText("DEMO_FAILURE")).toBeTruthy();
    expect(screen.getByText(/line 80/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy command" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy output" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy error output" }),
    ).toBeTruthy();
  });

  it("uses the German Cockpit labels for tool details", async () => {
    localStorage.setItem(UI_KEYS.locale, "de");
    renderTool(
      entry({
        displayName: "Bash",
        files: [],
        kind: "shell",
        rawInput: "",
        rawResult: "",
        recognized: true,
        shell: {
          command: "run-demo-check",
          stdout: "",
          stderr: "DEMO_FAILURE",
          exitCode: 7,
          interrupted: false,
        },
        status: "error",
        summary: "run-demo-check",
      }),
    );

    expect(await screen.findByText("Fehlgeschlagen")).toBeTruthy();
    fireEvent.click(
      await screen.findByLabelText("Details für Bash ein- oder ausblenden"),
    );
    expect(screen.getByRole("heading", { name: "Befehl" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Fehlerausgabe" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Befehl kopieren" }),
    ).toBeTruthy();
  });
});
