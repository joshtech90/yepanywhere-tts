import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { UrlProjectId } from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitComposer } from "./CockpitComposer";
import {
  cockpitComposerDraftKey,
  rememberCockpitPrompt,
  writeCockpitComposerDraft,
} from "./core/composer";
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

function composer(
  port = sessionPort(),
  projectId = "project-1",
  sessionId = "session-1",
) {
  return (
    <I18nProvider>
      <CockpitComposer
        projectId={projectId}
        sessionId={sessionId}
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

  it("sends only on a plain desktop Enter outside keyboard composition", async () => {
    const resume = vi.spyOn(api, "resumeSession").mockResolvedValue({
      processId: "process-1",
      permissionMode: "default",
      modeVersion: 1,
      serverTimestamp: 0,
    });
    render(composer());
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Keep this draft safe." } });

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", repeat: true });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(resume).not.toHaveBeenCalled();

    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === "(pointer: coarse)",
        }) as MediaQueryList,
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(resume).not.toHaveBeenCalled();

    vi.mocked(window.matchMedia).mockImplementation(
      (query) => ({ media: query, matches: false }) as MediaQueryList,
    );
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
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

  it("queues with Ctrl+Enter while preserving ordinary draft input", async () => {
    const queue = vi.spyOn(api, "queueMessage").mockResolvedValue({
      queued: true,
      deferred: true,
      deferredMessages: [],
      serverTimestamp: Date.now(),
    });
    render(
      composer(
        sessionPort({
          processState: "in-turn",
          status: { owner: "self", processId: "process-1" },
        }),
      ),
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Queue this fictional note." } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

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

  it("uploads files pasted or dropped on the composer", async () => {
    runtime.transport.upload.mockResolvedValue({
      id: "upload-1",
      originalName: "notes.txt",
      name: "upload-1-notes.txt",
      path: "/demo/uploads/upload-1-notes.txt",
      size: 8,
      mimeType: "text/plain",
    });
    render(composer());
    const input = screen.getByRole("textbox");
    const pasted = new File(["invented"], "pasted.txt", {
      type: "text/plain",
    });
    const dropped = new File(["invented"], "dropped.txt", {
      type: "text/plain",
    });

    fireEvent.paste(input, {
      clipboardData: {
        items: [{ getAsFile: () => pasted, kind: "file" }],
      },
    });
    fireEvent.dragEnter(input, {
      dataTransfer: {
        dropEffect: "none",
        files: [dropped],
        types: ["Files"],
      },
    });
    expect(screen.getByText("Drop files to attach")).toBeTruthy();
    fireEvent.drop(input, {
      dataTransfer: {
        dropEffect: "copy",
        files: [dropped],
        types: ["Files"],
      },
    });

    await waitFor(() =>
      expect(runtime.transport.upload).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByText("pasted.txt")).toBeTruthy();
    expect(screen.getByText("dropped.txt")).toBeTruthy();
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

  it("isolates drafts and uploads when the session identity changes", async () => {
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
    writeCockpitComposerDraft(
      cockpitComposerDraftKey("local", "session-2"),
      "Draft for session two",
    );
    const view = render(composer());
    const input = view.container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    if (!input) throw new Error("file input missing");

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Draft for session one" },
    });
    fireEvent.change(input, {
      target: { files: [new File(["demo"], "session-one.txt")] },
    });
    await waitFor(() => expect(runtime.transport.upload).toHaveBeenCalled());

    view.rerender(
      composer(
        sessionPort({ actualSessionId: "session-2" }),
        "project-1",
        "session-2",
      ),
    );

    expect(observedSignal?.aborted).toBe(true);
    expect(screen.queryByText("session-one.txt")).toBeNull();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Draft for session two",
    );
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

  it("filters prompt history immediately while typing", () => {
    rememberCockpitPrompt("local", "Review the fictional launch checklist.");
    rememberCockpitPrompt("local", "Summarize the fictional release notes.");
    render(composer());

    fireEvent.click(
      screen.getByRole("button", { name: "Open prompt history" }),
    );
    const filter = screen.getByRole("searchbox", {
      name: "Filter prompt history",
    }) as HTMLInputElement;
    expect(document.activeElement).toBe(filter);
    let value = "";

    for (const character of "launch") {
      value += character;
      const startedAt = performance.now();
      fireEvent.change(filter, { target: { value } });
      expect(filter.value).toBe(value);
      expect(performance.now() - startedAt).toBeLessThan(100);
    }

    expect(
      screen.getByRole("button", {
        name: "Review the fictional launch checklist.",
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Summarize the fictional release notes.",
      }),
    ).toBeNull();

    fireEvent.change(filter, { target: { value: "absent" } });
    expect(screen.getByRole("status").textContent).toBe(
      "No saved prompts match this filter.",
    );
  });

  it("moves between filtered prompt-history results with arrow keys", () => {
    rememberCockpitPrompt("local", "Review the fictional launch checklist.");
    rememberCockpitPrompt("local", "Review the fictional release notes.");
    render(composer());

    fireEvent.click(
      screen.getByRole("button", { name: "Open prompt history" }),
    );
    const filter = screen.getByRole("searchbox", {
      name: "Filter prompt history",
    });
    fireEvent.change(filter, { target: { value: "Review" } });
    const first = screen.getByRole("button", {
      name: "Review the fictional release notes.",
    });
    const second = screen.getByRole("button", {
      name: "Review the fictional launch checklist.",
    });

    const arrowUp = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowUp",
    });
    fireEvent(filter, arrowUp);
    expect(arrowUp.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(filter);

    fireEvent.keyDown(filter, { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second, { key: "ArrowUp" });
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(document.activeElement).toBe(filter);
  });

  it("dismisses prompt history without leaking Escape to global shortcuts", () => {
    rememberCockpitPrompt("local", "Review the fictional launch checklist.");
    render(composer());
    const trigger = screen.getByRole("button", { name: "Open prompt history" });

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Recent prompts" });
    expect(
      screen.getByRole("button", {
        name: "Review the fictional launch checklist.",
      }),
    ).toBeTruthy();
    const filter = screen.getByRole("searchbox", {
      name: "Filter prompt history",
    });
    expect(document.activeElement).toBe(filter);
    const escapeEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    fireEvent(filter, escapeEvent);

    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    const reopened = screen.getByRole("dialog", { name: "Recent prompts" });
    const input = screen.getByRole("textbox");
    input.focus();
    const globalEscape = vi.fn();
    document.addEventListener("keydown", globalEscape);
    const escapedOutside = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    fireEvent(input, escapedOutside);
    document.removeEventListener("keydown", globalEscape);
    expect(escapedOutside.defaultPrevented).toBe(true);
    expect(globalEscape).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    const reopenedForPointer = screen.getByRole("dialog", {
      name: "Recent prompts",
    });
    input.focus();
    fireEvent.pointerDown(input);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(dialog.isConnected).toBe(false);
    expect(reopened.isConnected).toBe(false);
    expect(reopenedForPointer.isConnected).toBe(false);
  });
});
