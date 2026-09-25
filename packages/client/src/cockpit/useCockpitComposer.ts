import type { UploadedFile } from "@yep-anywhere/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DeferredQueueMessage } from "../api/client";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import {
  getAttachmentUploadLongEdgePx,
  useAttachmentUploadQuality,
} from "../hooks/useAttachmentUploadQuality";
import {
  getShowThinkingSetting,
  getThinkingSetting,
} from "../hooks/useModelSettings";
import { useProviders } from "../hooks/useProviders";
import { useI18n } from "../i18n";
import { resolveSessionProviderCapabilities } from "../lib/providerCapabilities";
import {
  revokeAttachmentPreviewUrls,
  type ComposerUploadedAttachment,
} from "../lib/sessionComposerAttachments";
import { uploadComposerAttachmentFile } from "../lib/sessionComposerSubmission";
import type { PermissionMode, SessionMetadata, SessionStatus } from "../types";
import {
  cockpitComposerDraftKey,
  type CockpitComposerAction,
  createCockpitSubmissionMetadata,
  deriveCockpitComposerActions,
  frequentCockpitPrompts,
  readCockpitComposerSessionDraft,
  readCockpitPromptHistory,
  rememberCockpitPrompt,
  removeCockpitPrompt,
  writeCockpitComposerDraft,
} from "./core/composer";

export interface CockpitComposerAttachment {
  id: string;
  file: File;
  name: string;
  size: number;
  progress: number;
  status: "uploading" | "ready" | "failed" | "cancelled";
  uploaded?: ComposerUploadedAttachment;
  error?: string;
}

export interface CockpitComposerSessionPort {
  actualSessionId: string;
  addPendingMessage: (
    content: string,
    attachments?: UploadedFile[],
    timestamp?: string,
  ) => { tempId: string };
  permissionMode: PermissionMode;
  processState: "idle" | "in-turn" | "waiting-input";
  reconnectStream: () => void;
  removePendingMessage: (tempId: string) => void;
  session: SessionMetadata | null;
  setDeferredMessages: (messages: DeferredQueueMessage[]) => void;
  setProcessState: (state: "idle" | "in-turn" | "waiting-input") => void;
  setStatus: (status: SessionStatus) => void;
  status: SessionStatus;
}

export function useCockpitComposer(
  projectId: string,
  sessionId: string,
  sessionPort: CockpitComposerSessionPort,
) {
  const runtime = useCurrentSourceRuntime();
  const { t } = useI18n();
  const { providers } = useProviders();
  const [attachmentQuality] = useAttachmentUploadQuality();
  const providerCapabilities = useMemo(
    () =>
      resolveSessionProviderCapabilities({
        providers,
        providerName: sessionPort.session?.provider,
      }),
    [providers, sessionPort.session?.provider],
  );
  const actions = deriveCockpitComposerActions({
    processState: sessionPort.processState,
    supportsSteering: providerCapabilities.generallySupportsSteering,
  });
  const draftKey = cockpitComposerDraftKey(
    runtime.sourceKey,
    projectId,
    sessionId,
  );
  const [draft, setDraftState] = useState(() =>
    readCockpitComposerSessionDraft(runtime.sourceKey, projectId, sessionId),
  );
  const [attachments, setAttachments] = useState<
    CockpitComposerAttachment[]
  >([]);
  const attachmentsRef = useRef<CockpitComposerAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptHistory, setPromptHistory] = useState(() =>
    readCockpitPromptHistory(runtime.sourceKey),
  );
  const typingStartedAtRef = useRef<string | null>(
    draft.trim() ? new Date().toISOString() : null,
  );
  const lastEditedAtRef = useRef<string | null>(typingStartedAtRef.current);
  const uploadsRef = useRef(new Map<string, AbortController>());
  const mountedRef = useRef(true);

  attachmentsRef.current = attachments;

  useEffect(() => {
    const restored = readCockpitComposerSessionDraft(
      runtime.sourceKey,
      projectId,
      sessionId,
    );
    setDraftState(restored);
    typingStartedAtRef.current = restored.trim()
      ? new Date().toISOString()
      : null;
    lastEditedAtRef.current = typingStartedAtRef.current;
  }, [draftKey, projectId, runtime.sourceKey, sessionId]);

  useEffect(() => {
    setPromptHistory(readCockpitPromptHistory(runtime.sourceKey));
  }, [runtime.sourceKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const controller of uploadsRef.current.values()) controller.abort();
      revokeAttachmentPreviewUrls(
        attachmentsRef.current.flatMap((attachment) =>
          attachment.uploaded ? [attachment.uploaded] : [],
        ),
      );
    };
  }, []);

  const setDraft = useCallback(
    (next: string) => {
      const now = new Date().toISOString();
      if (next.trim()) {
        typingStartedAtRef.current ??= now;
        lastEditedAtRef.current = now;
      } else {
        typingStartedAtRef.current = null;
        lastEditedAtRef.current = null;
      }
      setDraftState(next);
      writeCockpitComposerDraft(draftKey, next);
      setError(null);
    },
    [draftKey],
  );

  const startUpload = useCallback(
    (attachment: CockpitComposerAttachment) => {
      const controller = new AbortController();
      uploadsRef.current.set(attachment.id, controller);
      setAttachments((current) =>
        current.map((candidate) =>
          candidate.id === attachment.id
            ? {
                ...candidate,
                progress: 0,
                status: "uploading",
                error: undefined,
              }
            : candidate,
        ),
      );
      void uploadComposerAttachmentFile({
        file: attachment.file,
        sourceTransport: runtime.transport,
        projectId,
        sessionId,
        maxLongEdgePx: getAttachmentUploadLongEdgePx(attachmentQuality),
        signal: controller.signal,
        onProgress: (bytesUploaded, uploadFile) => {
          setAttachments((current) =>
            current.map((candidate) =>
              candidate.id === attachment.id
                ? {
                    ...candidate,
                    progress: Math.round((bytesUploaded / uploadFile.size) * 100),
                  }
                : candidate,
            ),
          );
        },
      })
        .then((uploaded) => {
          if (!mountedRef.current) return;
          setAttachments((current) =>
            current.map((candidate) =>
              candidate.id === attachment.id
                ? {
                    ...candidate,
                    progress: 100,
                    status: "ready",
                    uploaded: uploaded as ComposerUploadedAttachment,
                  }
                : candidate,
            ),
          );
        })
        .catch((uploadError: unknown) => {
          if (!mountedRef.current) return;
          const cancelled = controller.signal.aborted;
          setAttachments((current) =>
            current.map((candidate) =>
              candidate.id === attachment.id
                ? {
                    ...candidate,
                    status: cancelled ? "cancelled" : "failed",
                    error: cancelled
                      ? undefined
                      : uploadError instanceof Error
                        ? uploadError.message
                        : String(uploadError),
                  }
                : candidate,
            ),
          );
        })
        .finally(() => uploadsRef.current.delete(attachment.id));
    },
    [attachmentQuality, projectId, runtime.transport, sessionId],
  );

  const attachFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const attachment: CockpitComposerAttachment = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          file,
          name: file.name,
          size: file.size,
          progress: 0,
          status: "uploading",
        };
        setAttachments((current) => [...current, attachment]);
        startUpload(attachment);
      }
    },
    [startUpload],
  );

  const removeAttachment = useCallback((id: string) => {
    uploadsRef.current.get(id)?.abort();
    setAttachments((current) => {
      const removed = current.find((attachment) => attachment.id === id);
      if (removed?.uploaded) revokeAttachmentPreviewUrls([removed.uploaded]);
      return current.filter((attachment) => attachment.id !== id);
    });
  }, []);

  const retryAttachment = useCallback(
    (id: string) => {
      const attachment = attachments.find((candidate) => candidate.id === id);
      if (attachment) startUpload(attachment);
    },
    [attachments, startUpload],
  );

  const submit = useCallback(
    async (action: CockpitComposerAction = actions.primary) => {
      const text = draft.trim();
      const uploaded = attachments.flatMap((attachment) =>
        attachment.status === "ready" && attachment.uploaded
          ? [attachment.uploaded]
          : [],
      );
      if ((!text && uploaded.length === 0) || submitting) return false;
      if (attachments.some((attachment) => attachment.status !== "ready")) {
        setError(t("sessionUploading"));
        return false;
      }

      setSubmitting(true);
      setError(null);
      const submittedAt = new Date().toISOString();
      const metadata = createCockpitSubmissionMetadata({
        action,
        typingStartedAt: typingStartedAtRef.current,
        lastEditedAt: lastEditedAtRef.current,
        submittedAt,
      });
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let pendingId: string | null = null;
      const previousProcessState = sessionPort.processState;

      try {
        if (action === "queue") {
          const result = await runtime.transport.fetch<{
            deferredMessages?: DeferredQueueMessage[];
          }>(`/sessions/${sessionPort.actualSessionId}/messages`, {
            method: "POST",
            body: JSON.stringify({
              message: text,
              mode: sessionPort.permissionMode,
              attachments: uploaded.length ? uploaded : undefined,
              tempId,
              thinking: getThinkingSetting(),
              showThinking: getShowThinkingSetting(),
              deferred: true,
              clientTimestamp: Date.parse(submittedAt),
              messageMetadata: metadata,
            }),
          });
          sessionPort.setDeferredMessages(result.deferredMessages ?? []);
        } else {
          pendingId = sessionPort.addPendingMessage(
            text,
            uploaded.length ? uploaded : undefined,
            submittedAt,
          ).tempId;
          sessionPort.setProcessState("in-turn");
          if (sessionPort.status.owner === "none") {
            const result = await runtime.transport.fetch<{
              processId: string;
              permissionMode: PermissionMode;
              appliedPermissionMode?: PermissionMode;
              modeVersion: number;
              recapAfterSeconds?: number;
            }>(
              `/projects/${projectId}/sessions/${sessionPort.actualSessionId}/resume`,
              {
                method: "POST",
                body: JSON.stringify({
                  message: text,
                  attachments: uploaded.length ? uploaded : undefined,
                  tempId: pendingId,
                  clientTimestamp: Date.parse(submittedAt),
                  messageMetadata: metadata,
                  mode: sessionPort.permissionMode,
                  model: sessionPort.session?.model,
                  provider: sessionPort.session?.provider,
                  thinking: getThinkingSetting(),
                  showThinking: getShowThinkingSetting(),
                }),
              },
            );
            sessionPort.setStatus({
              owner: "self",
              processId: result.processId,
              permissionMode: result.permissionMode,
              appliedPermissionMode: result.appliedPermissionMode,
              modeVersion: result.modeVersion,
              recapAfterSeconds: result.recapAfterSeconds,
            });
          } else {
            const result = await runtime.transport.fetch<{
              restarted?: boolean;
              processId?: string;
            }>(`/sessions/${sessionPort.actualSessionId}/messages`, {
              method: "POST",
              body: JSON.stringify({
                message: text,
                mode: sessionPort.permissionMode,
                attachments: uploaded.length ? uploaded : undefined,
                tempId: pendingId,
                thinking: getThinkingSetting(),
                showThinking: getShowThinkingSetting(),
                clientTimestamp: Date.parse(submittedAt),
                messageMetadata: metadata,
              }),
            });
            if (result.restarted && result.processId) {
              sessionPort.setStatus({
                owner: "self",
                processId: result.processId,
              });
              sessionPort.reconnectStream();
            }
          }
        }

        writeCockpitComposerDraft(draftKey, "");
        rememberCockpitPrompt(runtime.sourceKey, text, submittedAt);
        setPromptHistory(readCockpitPromptHistory(runtime.sourceKey));
        setDraftState("");
        typingStartedAtRef.current = null;
        lastEditedAtRef.current = null;
        revokeAttachmentPreviewUrls(uploaded);
        setAttachments([]);
        return true;
      } catch (submitError) {
        if (pendingId) sessionPort.removePendingMessage(pendingId);
        sessionPort.setProcessState(previousProcessState);
        const message =
          submitError instanceof Error ? submitError.message : String(submitError);
        setError(
          t(action === "queue" ? "sessionQueueFailed" : "sessionSendFailed", {
            message,
          }),
        );
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [
      actions.primary,
      attachments,
      draft,
      draftKey,
      projectId,
      runtime.sourceKey,
      runtime.transport,
      sessionPort,
      submitting,
      t,
    ],
  );

  const removePrompt = useCallback(
    (text: string) => {
      setPromptHistory(removeCockpitPrompt(runtime.sourceKey, text));
    },
    [runtime.sourceKey],
  );

  return {
    actions,
    attachFiles,
    attachments,
    draft,
    error,
    frequentPrompts: frequentCockpitPrompts(promptHistory),
    promptHistory,
    removeAttachment,
    removePrompt,
    retryAttachment,
    setDraft,
    submit,
    submitting,
  };
}
