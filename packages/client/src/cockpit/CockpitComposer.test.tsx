import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UrlProjectId } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitComposer } from "./CockpitComposer";
import { rememberCockpitPrompt } from "./core/composer";
import type { CockpitComposerSessionPort } from "./useCockpitComposer";

const runtime = vi.hoisted(() => ({
  sourceKey: "local",
  transport: {
    upload: vi.fn(),
    uploadStagedAttachment: vi.fn(),
  },
}));

vi.mock("../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => runtime,
}));

vi.mock("../hooks/useProviders", () => ({
  useProviders: () => ({
    providers: [
      {
        name: "codex",
        displayName: "Codex",
        installed: true,
        authenticated: true,
        enabled: true,
        supportsSteering: true,
      },
    ],
  }),
}));

vi.mock("../hooks/useAttachmentUploadQuality", () => ({
  useAttachmentUploadQuality: () => ["sd", vi.fn()],
  getAttachmentUploadLongEdgePx: () => 1024,
}));

function sessionPort(
  overrides: Partial<CockpitComposerSessionPort> = {},
): CockpitComposerSessionPort {
  return {
    actualSessionId: "session-1",
    addPendingMessage: vi.fn(() => ({ tempId: "temp-1" })),
    permissionMode: "default",
    processState: "idle",
    reconnectStream: vi.fn(),
    removePendingMessage: vi.fn(),
    session: {
      id: "session-1",
      projectId: "project-1" as UrlProjectId,
      projectName: "Atlas",
      title: "Demo",
      fullTitle: "Demo",
      createdAt: "2026-09-24T09:00:00.000Z",
      updatedAt: "2026-09-24T09:00:01.000Z",
      messageCount: 2,
      ownership: { owner: "none" },
      provider: "codex",
      model: "gpt-5.6-luna",
    },
    setDeferredMessages: vi.fn(),
    setProcessState: vi.fn(),
    setStatus: vi.fn(),
    status: { owner: "none" },
    ...overrides,
  };
}

function composer(port = sessionPort()) {
  return (
    <I18nProvider>
      <CockpitComposer
        projectId="project-1"
        sessionId="session-1"
        sessionPort={port}
      />
    </I18nProvider>
  );
}

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(UI_KEYS.locale, "en");
  vi.restoreAllMocks();
  runtime.transport.upload.mockReset();
  runtime.transport.uploadStagedAttachment.mockReset();
});

describe("Cockpit composer", () => {
  it("acknowledges every sequential character while parent updates continue", () => {
    const port = sessionPort();
    const view = render(composer(port));
    const input = screen.getByRole("textbox", {
      name: "Send a message to resume...",
    }) as HTMLTextAreaElement;
    let value = "";

    for (const character of "quiet draft") {
      value += character;
      const startedAt = performance.now();
      fireEvent.change(input, { target: { value } });
      view.rerender(
        composer({ ...port, status: { owner: "none" } }),
      );
      expect(input.value).toBe(value);
      expect(performance.now() - startedAt).toBeLessThan(100);
    }
  });

  it("uses the provider steering lane and keeps queue as an explicit alternative", async () => {
    const queue = vi.spyOn(api, "queueMessage").mockResolvedValue({
      queued: true,
      deferred: true,
      deferredMessages: [],
      serverTimestamp: Date.now(),
    });
    const port = sessionPort({
      processState: "in-turn",
      status: { owner: "self", processId: "process-1" },
    });
    render(composer(port));

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Add one concise example." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Queue message" }));

    await waitFor(() => expect(queue).toHaveBeenCalledTimes(1));
    expect(queue.mock.calls[0]?.[6]).toBe(true);
    expect(queue.mock.calls[0]?.[8]).toMatchObject({
      deliveryIntent: "deferred",
    });
  });

  it("shows an upload failure and retries through the existing transport", async () => {
    runtime.transport.upload
      .mockRejectedValueOnce(new Error("preview upload unavailable"))
      .mockResolvedValueOnce({
        id: "upload-1",
        originalName: "notes.txt",
        name: "upload-1-notes.txt",
        path: "/demo/uploads/upload-1-notes.txt",
        size: 12,
        mimeType: "text/plain",
      });
    const view = render(composer());
    const input = view.container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    if (!input) throw new Error("file input missing");

    fireEvent.change(input, {
      target: { files: [new File(["demo"], "notes.txt", { type: "text/plain" })] },
    });

    expect(await screen.findByText("preview upload unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(runtime.transport.upload).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull(),
    );
  });

  it("aborts an in-flight upload when its attachment is removed", async () => {
    let observedSignal: AbortSignal | undefined;
    runtime.transport.upload.mockImplementation(
      (_projectId, _sessionId, _file, options) =>
        new Promise((_resolve, reject) => {
          observedSignal = options?.signal;
          options?.signal?.addEventListener("abort", () =>
            reject(new DOMException("cancelled", "AbortError")),
          );
        }),
    );
    const view = render(composer());
    const input = view.container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    if (!input) throw new Error("file input missing");

    fireEvent.change(input, {
      target: { files: [new File(["demo"], "draft.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(runtime.transport.upload).toHaveBeenCalled());
    fireEvent.click(
      screen.getByRole("button", { name: "Remove draft.txt" }),
    );

    expect(observedSignal?.aborted).toBe(true);
    expect(screen.queryByText("draft.txt")).toBeNull();
  });

  it("recalls frequent source-local prompts into the draft without sending", () => {
    rememberCockpitPrompt("local", "Summarize the fictional release notes.");
    rememberCockpitPrompt("local", "Summarize the fictional release notes.");
    render(composer());

    fireEvent.click(
      screen.getByRole("button", { name: "Open prompt history" }),
    );
    expect(screen.getByText("Frequently used")).toBeTruthy();
    const promptButton = screen.getAllByRole("button", {
      name: /Summarize the fictional release notes/,
    })[0];
    if (!promptButton) throw new Error("prompt button missing");
    fireEvent.click(promptButton);

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Summarize the fictional release notes.",
    );
  });
});
