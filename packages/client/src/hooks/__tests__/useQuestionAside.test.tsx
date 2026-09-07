// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { I18nProvider } from "../../i18n";
import type { SourceApiClient } from "../../lib/sourceRuntime";
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
      const sourceApi: SourceApiClient = {
        getSession: async () => ({
          session: { id: "child" } as Awaited<
            ReturnType<SourceApiClient["getSession"]>
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
        getSessionMetadata: vi.fn(),
      };
      const showToast = vi.fn();
      const { result } = renderHook(
        () =>
          useQuestionAside({
            projectId: "project",
            sessionId: "parent",
            sourceApi,
            provider: "codex",
            model: undefined,
            executor: undefined,
            nativeContextRoute,
            showToast,
            onSaved: vi.fn(),
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
          sourceApi: { getSession, getSessionMetadata: vi.fn() },
          provider: "codex",
          model: undefined,
          executor: undefined,
          nativeContextRoute: false,
          showToast: vi.fn(),
          onSaved: vi.fn(),
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
