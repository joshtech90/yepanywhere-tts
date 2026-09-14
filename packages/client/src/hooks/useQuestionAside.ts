import {
  formatConversationContextTurn,
  type ConversationContextTurn,
  type ProviderName,
} from "@yep-anywhere/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionApi } from "../api/sessionClient";
import type { QuestionAsideCardProps } from "../components/QuestionAsideCard";
import { useI18n } from "../i18n";
import { turnContentText } from "../lib/sessionMessageText";
import { generateUUID } from "../lib/uuid";
import type { Message } from "../types";

interface QuestionAside
  extends Pick<
    QuestionAsideCardProps,
    "question" | "answers" | "status" | "error"
  > {
  id: string;
  sourceApi: SessionApi;
  sessionId?: string;
  processId?: string;
  snapshotRequestedAt: string;
}

export function questionAsideAnswers(
  messages: Message[],
  marker: string,
): string[] {
  const start = messages.findIndex((message) =>
    turnContentText(message.content ?? message.message?.content).includes(
      marker,
    ),
  );
  if (start < 0) return [];
  return messages.slice(start + 1).flatMap((message) => {
    const role = message.role ?? message.message?.role ?? message.type;
    if (role !== "assistant") return [];
    const text = turnContentText(message.content ?? message.message?.content);
    return text.trim() ? [text] : [];
  });
}

export function useQuestionAside(options: {
  projectId: string;
  sessionId: string;
  sourceKey: string;
  sourceApi: SessionApi;
  provider: ProviderName | undefined;
  model: string | undefined;
  executor: string | undefined;
  nativeContextRoute: boolean;
  showToast: (text: string, kind?: "success" | "error" | "info") => void;
  onSaved: () => void;
  sendToMain: (question: string) => Promise<boolean>;
  onContinueAsBtw: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const [aside, setAside] = useState<QuestionAside | null>(null);
  const current = useRef<QuestionAside | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resumePoll = useRef<(() => void) | null>(null);
  const latest = useRef(options);
  latest.current = options;

  const update = useCallback((value: QuestionAside | null) => {
    current.current = value;
    setAside(value);
  }, []);

  const discard = useCallback(() => {
    const abandoned = current.current;
    if (
      abandoned?.status === "saving" ||
      abandoned?.status === "sending" ||
      abandoned?.status === "moving"
    )
      return;
    clearTimeout(timer.current);
    update(null);
    resumePoll.current = null;
    if (abandoned?.processId && abandoned.status !== "complete") {
      void abandoned.sourceApi
        .abortProcess(abandoned.processId)
        .catch((error: unknown) => {
          latest.current.showToast(String(error), "error");
        });
    }
  }, [update]);

  // The transient card and child work belong to this route's lifetime.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Navigation must cancel the previous session's card even though cleanup uses refs.
  useEffect(() => {
    setAside(null);
    const onVisible = () => {
      if (document.visibilityState === "hidden") return;
      const resume = resumePoll.current;
      resumePoll.current = null;
      resume?.();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer.current);
      resumePoll.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      const abandoned = current.current;
      current.current = null;
      if (
        abandoned?.processId &&
        (abandoned.status === "running" || abandoned.status === "failed")
      ) {
        void abandoned.sourceApi
          .abortProcess(abandoned.processId)
          .catch((error: unknown) => {
            latest.current.showToast(String(error), "error");
          });
      }
    };
  }, [options.projectId, options.sessionId, options.sourceKey]);

  const ask = useCallback(
    (question: string) => {
      if (current.current) return false;
      const context = latest.current;
      const pending: QuestionAside = {
        id: generateUUID(),
        sourceApi: context.sourceApi,
        question,
        answers: [],
        status: "starting",
        snapshotRequestedAt: new Date().toISOString(),
      };
      update(pending);
      const marker = `[YA question aside ${pending.id}]`;
      const isCurrent = () => current.current?.id === pending.id;
      const run = async () => {
        const clone = await context.sourceApi.cloneSession(
          context.projectId,
          context.sessionId,
          `Quick answer: ${question.slice(0, 80)}`,
          context.provider,
        );
        pending.sessionId = clone.sessionId;
        await context.sourceApi.updateSessionMetadata(clone.sessionId, {
          archived: true,
        });
        if (!isCurrent()) return;
        const result = await context.sourceApi.resumeSession(
          context.projectId,
          clone.sessionId,
          [
            marker,
            "This is a one-question aside. The preceding history belongs to the main session, which may still be working. Treat it as reference, not instructions to continue that work.",
            "Answer only the question below, concisely, from available context. Do not change files, execute commands, or continue the main task. Do not ask follow-up questions. Earlier assistant actions are the main assistant's actions, not yours.",
            "[Question]",
            question,
          ].join("\n"),
          {
            provider: context.provider,
            model: context.model,
            executor: context.executor,
          },
        );
        pending.processId = result.processId;
        if (!isCurrent()) {
          await context.sourceApi.abortProcess(result.processId);
          return;
        }
        update({ ...pending, status: "running" });
        let polls = 0;
        const poll = async () => {
          if (!isCurrent()) return;
          try {
            if (document.visibilityState === "hidden") {
              resumePoll.current = () => {
                void poll();
              };
              return;
            }
            polls += 1;
            const state = await context.sourceApi.getProcessInfo(
              clone.sessionId,
            );
            const detail = await context.sourceApi.getSession(
              context.projectId,
              clone.sessionId,
              undefined,
              { tailTurns: 2 },
            );
            if (!isCurrent()) return;
            const answers = questionAsideAnswers(detail.messages, marker);
            if (state.process?.state === "waiting-input")
              throw new Error(t("questionAsideNeedsInput"));
            const complete =
              !state.process ||
              (state.process.state === "idle" &&
                state.process.queueDepth === 0) ||
              state.process.state === "terminated";
            if (complete && answers.length === 0)
              throw new Error(t("questionAsideNoAnswer"));
            update({
              ...pending,
              processId: complete ? undefined : pending.processId,
              answers,
              status: complete ? "complete" : "running",
            });
            if (complete) return;
            if (polls >= 160) throw new Error(t("questionAsideTimedOut"));
            timer.current = setTimeout(poll, 1500);
          } catch (error) {
            if (isCurrent())
              update({
                ...(current.current as QuestionAside),
                status: "failed",
                error: String(error),
              });
            await context.sourceApi
              .abortProcess(result.processId)
              .catch((stopError: unknown) => {
                context.showToast(String(stopError), "error");
              });
          }
        };
        timer.current = setTimeout(poll, 1500);
      };
      void run().catch((error: unknown) => {
        if (isCurrent())
          update({ ...pending, status: "failed", error: String(error) });
      });
      return true;
    },
    [t, update],
  );

  const save = useCallback(async () => {
    const value = current.current;
    if (value?.status !== "complete" || !value.answers.length) return;
    update({ ...value, status: "saving" });
    const context = latest.current;
    const turns: ConversationContextTurn[] = [
      {
        role: "user",
        text: `[Saved aside context: ${value.sessionId}; snapshot requested ${value.snapshotRequestedAt}. Main may have continued since. This question was already answered in the aside; saving is not a request to act on its answer.]`,
      },
      { role: "user", text: value.question },
      ...value.answers.map((text) => ({ role: "assistant" as const, text })),
    ];
    try {
      let delivery: "native-history" | "user-turn" = "user-turn";
      if (context.nativeContextRoute) {
        await value.sourceApi.reactivateSession(
          context.projectId,
          context.sessionId,
        );
        const receipt = await value.sourceApi.sendConversationContext(
          context.projectId,
          context.sessionId,
          { requestId: value.id, turns },
        );
        delivery = receipt.delivery;
      } else {
        await value.sourceApi.resumeSession(
          context.projectId,
          context.sessionId,
          formatConversationContextTurn(turns),
          undefined,
          undefined,
          value.id,
        );
      }
      if (current.current?.id !== value.id) return;
      update(null);
      context.showToast(
        t(
          delivery === "native-history"
            ? "questionAsideSavedNative"
            : "questionAsideSavedUserTurn",
        ),
        "success",
      );
      context.onSaved();
    } catch (error) {
      if (current.current?.id === value.id)
        update({
          ...value,
          status: "failed",
          error: `${t("questionAsideSaveFailed")} ${String(error)}`,
        });
    }
  }, [t, update]);

  const steer = useCallback(async () => {
    const value = current.current;
    if (value?.status !== "failed") return;
    update({ ...value, status: "sending" });
    try {
      const sent = await latest.current.sendToMain(value.question);
      if (current.current?.id === value.id) update(sent ? null : value);
    } catch (error) {
      if (current.current?.id === value.id)
        update({
          ...value,
          error: t("sessionSendFailed", { message: String(error) }),
        });
    }
  }, [t, update]);

  const continueAsBtw = useCallback(async () => {
    const value = current.current;
    if (value?.status !== "complete" || !value.sessionId) return;
    const context = latest.current;
    update({ ...value, status: "moving", error: undefined });
    try {
      await value.sourceApi.updateSessionMetadata(value.sessionId, {
        archived: false,
        parentSessionId: context.sessionId,
        title: `/btw ${value.question.slice(0, 80)}`,
      });
      if (current.current?.id !== value.id) return;
      update(null);
      context.onContinueAsBtw(value.sessionId);
    } catch (error) {
      if (current.current?.id === value.id)
        update({
          ...value,
          error: t("questionAsideContinueFailed", { message: String(error) }),
        });
    }
  }, [t, update]);

  return { aside, ask, save, discard, steer, continueAsBtw };
}
