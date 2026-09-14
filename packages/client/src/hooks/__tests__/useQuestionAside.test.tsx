// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { I18nProvider } from "../../i18n";
import type { SessionApi } from "../../api/sessionClient";
import { useQuestionAside } from "../useQuestionAside";

describe("one-shot question aside", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([false, true])(
    "keeps question work isolated and saves once (native route %s)",
    async (nativeContextRoute) => {
      const clone = vi.spyOn(api, "cloneSession").mockResolvedValue({
        sessionId: "child",
        messageCount: 3,
        clonedFrom: "parent",
        provider: "codex",
      });
      const archive = vi
        .spyOn(api, "updateSessionMetadata")
        .mockResolvedValue({ updated: true });
      const resume = vi.spyOn(api, "resumeSession").mockResolvedValue({
        processId: "child-process",
        permissionMode: "default",
        modeVersion: 1,
        serverTimestamp: 0,
      });
      const getProcess = vi
        .spyOn(api, "getProcessInfo")
        .mockResolvedValue({ process: null });
      const reactivate = vi.spyOn(api, "reactivateSession").mockResolvedValue({
        processId: "parent-process",
        permissionMode: "default",
        modeVersion: 1,
        serverTimestamp: 0,
      });
      const inject = vi
        .spyOn(api, "sendConversationContext")
        .mockResolvedValue({ delivery: "native-history" });
      const sourceApi: SessionApi = {
        ...api,
        getSession: async () => ({
          session: { id: "child" } as Awaited<
            ReturnType<SessionApi["getSession"]>
          >["session"],
          ownership: { owner: "none" },
          messages: [
            {
              type: "assistant",
              content: "Parent's answer must not be copied",
            },
            { type: "user", content: resume.mock.calls[0]?.[2] ?? "" },
            {
              type: "assistant",
              content: [
                { type: "thinking", thinking: "private reasoning" },
                { type: "text", text: "  Actual answer.\n" },
              ],
            },
          ],
        }),
      };
      const showToast = vi.fn();
      const { result } = renderHook(
        () =>
          useQuestionAside({
            projectId: "project",
            sourceKey: "test-source",
            sessionId: "parent",
            sourceApi,
            provider: "codex",
            model: undefined,
            executor: undefined,
            nativeContextRoute,
            showToast,
            onSaved: vi.fn(),
            sendToMain: vi.fn(),
            onContinueAsBtw: vi.fn(),
          }),
        { wrapper: I18nProvider },
      );
      await act(async () => {
        expect(result.current.ask("  Why?")).toBe(true);
      });
      expect(clone).toHaveBeenCalledTimes(1);
      expect(archive).toHaveBeenCalledWith("child", { archived: true });
      expect(resume).toHaveBeenCalledTimes(1);
      expect(resume.mock.calls[0]?.[1]).toBe("child");
      expect(inject).not.toHaveBeenCalled();
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });
      expect(getProcess).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(result.current.aside?.status).toBe("complete");
      expect(result.current.aside?.processId).toBeUndefined();
      expect(result.current.aside?.answers).toEqual(["  Actual answer.\n"]);
      await act(async () => {
        await Promise.all([result.current.save(), result.current.save()]);
      });
      expect(result.current.aside).toBeNull();
      if (nativeContextRoute) {
        expect(reactivate).toHaveBeenCalledTimes(1);
        expect(inject).toHaveBeenCalledTimes(1);
        expect(inject.mock.calls[0]?.[2].turns.slice(1)).toEqual([
          { role: "user", text: "  Why?" },
          { role: "assistant", text: "  Actual answer.\n" },
        ]);
        expect(resume).toHaveBeenCalledTimes(1);
      } else {
        expect(reactivate).not.toHaveBeenCalled();
        expect(inject).not.toHaveBeenCalled();
        expect(resume).toHaveBeenCalledTimes(2);
        expect(resume.mock.calls[1]?.[1]).toBe("parent");
        expect(resume.mock.calls[1]?.[2]).toContain(
          "[assistant]\n  Actual answer.\n",
        );
        expect(showToast).toHaveBeenCalledWith(
          expect.stringContaining("user message"),
          "success",
        );
      }
    },
  );

  it("continues the answered child once and retains the card when moving fails", async () => {
    const clone = vi.spyOn(api, "cloneSession").mockResolvedValue({
      sessionId: "child",
      messageCount: 1,
      clonedFrom: "parent",
      provider: "codex",
    });
    const metadata = vi
      .spyOn(api, "updateSessionMetadata")
      .mockResolvedValue({ updated: true });
    const resume = vi.spyOn(api, "resumeSession").mockResolvedValue({
      processId: "child-process",
      permissionMode: "default",
      modeVersion: 1,
      serverTimestamp: 0,
    });
    vi.spyOn(api, "getProcessInfo").mockResolvedValue({ process: null });
    const inject = vi.spyOn(api, "sendConversationContext");
    const onContinueAsBtw = vi.fn();
    const sourceApi: SessionApi = {
      ...api,
      getSession: async () => ({
        session: { id: "child" } as Awaited<
          ReturnType<SessionApi["getSession"]>
        >["session"],
        ownership: { owner: "none" },
        messages: [
          { type: "user", content: resume.mock.calls[0]?.[2] ?? "" },
          { type: "assistant", content: "Answer." },
        ],
      }),
    };
    const { result } = renderHook(
      () =>
        useQuestionAside({
          projectId: "project",
          sessionId: "parent",
          sourceApi,
          sourceKey: "test-source",
          provider: "codex",
          model: undefined,
          executor: undefined,
          nativeContextRoute: true,
          showToast: vi.fn(),
          onSaved: vi.fn(),
          sendToMain: vi.fn(),
          onContinueAsBtw,
        }),
      { wrapper: I18nProvider },
    );
    await act(async () => {
      result.current.ask("Why?");
    });
    await act(async () => {
      await result.current.continueAsBtw();
    });
    expect(onContinueAsBtw).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(result.current.aside?.status).toBe("complete");
    metadata.mockRejectedValueOnce(new Error("Network unavailable"));
    await act(async () => {
      await result.current.continueAsBtw();
    });
    expect(result.current.aside).toMatchObject({
      status: "complete",
      answers: ["Answer."],
      error: expect.stringContaining("Network unavailable"),
    });
    expect(onContinueAsBtw).not.toHaveBeenCalled();
    let finishMove!: (value: { updated: boolean }) => void;
    metadata.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishMove = resolve;
        }),
    );
    let moving!: Promise<void>;
    act(() => {
      moving = result.current.continueAsBtw();
      void result.current.continueAsBtw();
      result.current.discard();
      void result.current.save();
    });
    expect(result.current.aside?.status).toBe("moving");
    expect(metadata).toHaveBeenCalledTimes(3);
    await act(async () => {
      finishMove({ updated: true });
      await moving;
    });
    expect(metadata).toHaveBeenLastCalledWith("child", {
      archived: false,
      parentSessionId: "parent",
      title: "/btw Why?",
    });
    expect(result.current.aside).toBeNull();
    expect(onContinueAsBtw).toHaveBeenCalledTimes(1);
    expect(onContinueAsBtw).toHaveBeenCalledWith("child");
    expect(clone).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(inject).not.toHaveBeenCalled();
  });

  it("steers a failed question once, preserves it on send failure, and closes on success", async () => {
    const clone = vi
      .spyOn(api, "cloneSession")
      .mockRejectedValue(new Error("Provider session startup did not settle"));
    let finishSend!: (sent: boolean) => void;
    const sendToMain = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishSend = resolve;
        }),
    );
    const { result } = renderHook(
      () =>
        useQuestionAside({
          projectId: "project",
          sessionId: "parent",
          sourceApi: { ...api, getSession: vi.fn() },
          sourceKey: "test-source",
          provider: "codex",
          model: undefined,
          executor: undefined,
          nativeContextRoute: false,
          showToast: vi.fn(),
          onSaved: vi.fn(),
          sendToMain,
          onContinueAsBtw: vi.fn(),
        }),
      { wrapper: I18nProvider },
    );
    await act(async () => {
      result.current.ask("  Why did this fail?");
    });
    expect(result.current.aside?.status).toBe("failed");
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.steer();
      void result.current.steer();
      result.current.discard();
    });
    expect(result.current.aside?.status).toBe("sending");
    expect(sendToMain).toHaveBeenCalledTimes(1);
    expect(sendToMain).toHaveBeenCalledWith("  Why did this fail?");
    await act(async () => {
      finishSend(false);
      await pending;
    });
    expect(result.current.aside?.status).toBe("failed");
    expect(result.current.aside?.question).toBe("  Why did this fail?");
    sendToMain.mockRejectedValueOnce(new Error("Network unavailable"));
    await act(async () => {
      await result.current.steer();
    });
    expect(result.current.aside?.status).toBe("failed");
    expect(result.current.aside?.error).toContain("Network unavailable");
    sendToMain.mockResolvedValueOnce(true);
    await act(async () => {
      await result.current.steer();
    });
    expect(result.current.aside).toBeNull();
    expect(sendToMain).toHaveBeenCalledTimes(3);
    expect(clone).toHaveBeenCalledTimes(1);
  });

  it("cancels a dismissed child even when its launch finishes afterward", async () => {
    vi.spyOn(api, "cloneSession").mockResolvedValue({
      sessionId: "child",
      messageCount: 1,
      clonedFrom: "parent",
      provider: "codex",
    });
    vi.spyOn(api, "updateSessionMetadata").mockResolvedValue({ updated: true });
    let finishLaunch!: (
      value: Awaited<ReturnType<typeof api.resumeSession>>,
    ) => void;
    const resume = vi.spyOn(api, "resumeSession").mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLaunch = resolve;
        }),
    );
    const abort = vi.spyOn(api, "abortProcess").mockResolvedValue({
      aborted: true,
      processId: "child-process",
      sessionId: "child",
      verifiedStopped: true,
      verification: "provider",
    });
    const getSession = vi.fn();
    const { result } = renderHook(
      () =>
        useQuestionAside({
          projectId: "project",
          sessionId: "parent",
          sourceApi: { ...api, getSession },
          sourceKey: "test-source",
          provider: "codex",
          model: undefined,
          executor: undefined,
          nativeContextRoute: false,
          showToast: vi.fn(),
          onSaved: vi.fn(),
          sendToMain: vi.fn(),
          onContinueAsBtw: vi.fn(),
        }),
      { wrapper: I18nProvider },
    );
    await act(async () => {
      result.current.ask("Why?");
    });
    act(() => result.current.discard());
    await act(async () => {
      finishLaunch({
        processId: "child-process",
        permissionMode: "default",
        modeVersion: 1,
        serverTimestamp: 0,
      });
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(result.current.aside).toBeNull();
    expect(abort).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledWith("child-process");
    expect(resume).toHaveBeenCalledTimes(1);
    expect(getSession).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
