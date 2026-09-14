import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createSessionApi } from "../../api/sessionClient";
import { I18nProvider } from "../../i18n";
import { getSourceRuntimeRegistry } from "../../lib/sourceRuntime";
import { asClientSummarySourceKey } from "../../lib/clientSummaryStore";
import { useQuestionAside } from "../useQuestionAside";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(
  ["clone", "resume", "running", "reactivate"].flatMap((phase) =>
    [true, false].map((unmount) => ({ phase, unmount })),
  ),
)(
  "keeps late $phase follow-ups on the originating source (unmount $unmount)",
  async ({ phase, unmount }) => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const registry = getSourceRuntimeRegistry();
    const original = registry.getCurrentSourceRuntime().sourceKey;
    const sourceA = asClientSummarySourceKey(`question-source-a-${phase}`);
    const sourceB = asClientSummarySourceKey(`question-source-b-${phase}`);
    const runtime = registry.getOrCreateSourceRuntime(sourceA);
    const sourceApi = createSessionApi((path, options) =>
      runtime.transport.fetch(path, options),
    );
    let finish!: () => void;
    const delayed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let prompt = "";
    const source = vi
      .spyOn(runtime.transport, "fetch")
      .mockImplementation(async (path, options) => {
        if (path.endsWith(`/${phase}`)) await delayed;
        if (path.endsWith("/clone"))
          return {
            sessionId: "child",
            messageCount: 1,
            clonedFrom: "parent",
            provider: "codex",
          };
        if (path.endsWith("/resume"))
          prompt = JSON.parse(String(options?.body)).message;
        if (path.endsWith("/resume") || path.endsWith("/reactivate"))
          return {
            processId: "child-process",
            permissionMode: "default",
            modeVersion: 1,
            serverTimestamp: 0,
          };
        if (path.endsWith("/metadata")) return { updated: true };
        if (path.endsWith("/abort"))
          return {
            aborted: true,
            processId: "child-process",
            sessionId: "child",
            verifiedStopped: true,
            verification: "provider",
          };
        if (path.endsWith("/process")) return { process: null };
        if (path.endsWith("/conversation-context"))
          return { delivery: "native-history" };
        if (path.includes("/sessions/child?"))
          return {
            session: { id: "child" },
            ownership: { owner: "none" },
            messages: [
              { type: "user", content: prompt },
              { type: "assistant", content: "Answer" },
            ],
          };
        throw new Error(`Unexpected request: ${path}`);
      });
    const otherRuntime = registry.getOrCreateSourceRuntime(sourceB);
    const otherApi = createSessionApi((path, options) =>
      otherRuntime.transport.fetch(path, options),
    );
    const other = vi
      .spyOn(otherRuntime.transport, "fetch")
      .mockRejectedValue(new Error("Wrong host"));
    const onSaved = vi.fn();
    registry.setCurrentSourceKey(sourceA);
    try {
      const hook = renderHook(
        ({ sourceKey }) =>
          useQuestionAside({
            projectId: "project",
            sessionId: "parent",
            sourceKey,
            sourceApi: sourceKey === sourceA ? sourceApi : otherApi,
            provider: "codex",
            model: undefined,
            executor: undefined,
            nativeContextRoute: true,
            showToast: vi.fn(),
            onSaved,
            sendToMain: vi.fn(),
            onContinueAsBtw: vi.fn(),
          }),
        { wrapper: I18nProvider, initialProps: { sourceKey: sourceA } },
      );
      await act(async () => {
        hook.result.current.ask("Why?");
      });
      let saving: Promise<void> | undefined;
      if (phase === "reactivate") {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1500);
        });
        expect(hook.result.current.aside?.status).toBe("complete");
        await act(async () => {
          saving = hook.result.current.save();
        });
      }
      if (unmount) hook.unmount();
      registry.setCurrentSourceKey(sourceB);
      if (!unmount) hook.rerender({ sourceKey: sourceB });
      await act(async () => {
        finish();
        await delayed;
        await saving;
      });
      const followUp =
        phase === "clone"
          ? "/sessions/child/metadata"
          : phase === "reactivate"
            ? "/projects/project/sessions/parent/conversation-context"
            : "/processes/child-process/abort";
      expect(source).toHaveBeenCalledWith(followUp, expect.any(Object));
      expect(other).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      finish();
      registry.setCurrentSourceKey(original);
      registry.disposeSource(sourceA);
      registry.disposeSource(sourceB);
    }
  },
);
