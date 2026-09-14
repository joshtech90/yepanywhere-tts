import type {
  ProviderName,
  ProviderRuntimeStatus,
  PromptSuggestionMode,
  RecapMode,
  SessionLivenessSnapshot,
  SessionMetadataResponse,
  SessionSandboxEnforcement,
  SlashCommand,
  UploadedFile,
  UserMessageMetadata,
} from "@yep-anywhere/shared";
import type {
  InputRequest,
  Message,
  PermissionMode,
  SessionMetadata,
  SessionStatus,
} from "../types";
import type {
  DeferredQueueMessage,
  PaginationInfo,
  SessionOptions,
} from "./client";
import type { fetchJSON as FetchJson } from "./sourceApiFetch";

export function createSessionApi(fetchJSON: typeof FetchJson) {
  return {
    getSession: (
      projectId: string,
      sessionId: string,
      afterMessageId?: string,
      options?: {
        tailCompactions?: number;
        beforeMessageId?: string;
        tailTurns?: number;
        tailFrom?: string;
        fullHistory?: boolean;
        fullHistoryReason?: string;
      },
    ) => {
      const params = new URLSearchParams();
      if (afterMessageId) params.set("afterMessageId", afterMessageId);
      if (options?.tailCompactions !== undefined)
        params.set("tailCompactions", String(options.tailCompactions));
      if (options?.beforeMessageId)
        params.set("beforeMessageId", options.beforeMessageId);
      if (options?.tailTurns !== undefined)
        params.set("tailTurns", String(options.tailTurns));
      if (options?.tailFrom) params.set("tailFrom", options.tailFrom);
      if (options?.fullHistory) params.set("fullHistory", "1");
      if (options?.fullHistoryReason)
        params.set("fullHistoryReason", options.fullHistoryReason);
      const qs = params.toString();
      return fetchJSON<{
        session: SessionMetadata;
        messages: Message[];
        transcriptSnapshotUpdatedAt?: string;
        ownership: SessionStatus;
        pendingInputRequest?: InputRequest | null;
        providerRuntimeStatus?: ProviderRuntimeStatus;
        slashCommands?: SlashCommand[] | null;
        deferredMessages?: DeferredQueueMessage[];
        pagination?: PaginationInfo;
      }>(`/projects/${projectId}/sessions/${sessionId}${qs ? `?${qs}` : ""}`);
    },

    getSessionMetadata: (projectId: string, sessionId: string) =>
      fetchJSON<SessionMetadataResponse>(
        `/projects/${projectId}/sessions/${sessionId}/metadata`,
      ),

    resumeSession: (
      projectId: string,
      sessionId: string,
      message: string,
      options?: SessionOptions,
      attachments?: UploadedFile[],
      tempId?: string,
      clientTimestamp?: number,
      messageMetadata?: UserMessageMetadata,
    ) =>
      fetchJSON<{
        processId: string;
        permissionMode: PermissionMode;
        appliedPermissionMode?: PermissionMode;
        modeVersion: number;
        recapAfterSeconds?: number;
        sandboxEnforcement?: SessionSandboxEnforcement;
        serverTimestamp: number;
        resume?: {
          requestedMode: "full" | "compact-first";
          provider?: ProviderName;
          outcome?: "queued" | "started";
          compaction?: { status: string; [key: string]: unknown };
        };
      }>(`/projects/${projectId}/sessions/${sessionId}/resume`, {
        method: "POST",
        body: JSON.stringify({
          message,
          mode: options?.mode,
          model: options?.model,
          serviceTier: options?.serviceTier,
          thinking: options?.thinking,
          showThinking: options?.showThinking,
          provider: options?.provider,
          executor: options?.executor,
          recapMode: options?.recapMode,
          recapAfterSeconds: options?.recapAfterSeconds,
          promptSuggestionMode: options?.promptSuggestionMode,
          helperSideModel: options?.helperSideModel,
          resumeMode: options?.resumeMode,
          attachments,
          tempId,
          clientTimestamp,
          messageMetadata,
        }),
      }),

    reactivateSession: (
      projectId: string,
      sessionId: string,
      options?: {
        mode?: PermissionMode;
        model?: string;
        provider?: ProviderName;
        executor?: string;
        recapAfterSeconds?: number;
      },
    ) =>
      fetchJSON<{
        processId: string;
        permissionMode: PermissionMode;
        appliedPermissionMode?: PermissionMode;
        modeVersion: number;
        recapAfterSeconds?: number;
        sandboxEnforcement?: SessionSandboxEnforcement;
        serverTimestamp: number;
      }>(`/projects/${projectId}/sessions/${sessionId}/reactivate`, {
        method: "POST",
        body: JSON.stringify({
          mode: options?.mode,
          model: options?.model,
          provider: options?.provider,
          executor: options?.executor,
          recapAfterSeconds: options?.recapAfterSeconds,
        }),
      }),

    abortProcess: (processId: string, options?: { blockResume?: boolean }) =>
      fetchJSON<{
        aborted: true;
        processId: string;
        sessionId: string;
        pid?: number;
        verifiedStopped: true;
        verification: "pid" | "provider" | "iterator";
        /** Present when the abort also exempted the session from auto-resume. */
        resumeExemption?: {
          heartbeatDisabled: boolean;
          autoResumeDisabled: boolean;
          error?: string;
        };
      }>(`/processes/${processId}/abort`, {
        method: "POST",
        ...(options?.blockResume
          ? { body: JSON.stringify({ blockResume: true }) }
          : {}),
      }),

    getProcessInfo: (sessionId: string) =>
      fetchJSON<{
        process: {
          id: string;
          sessionId: string;
          projectId: string;
          projectPath: string;
          projectName: string;
          sessionTitle: string | null;
          state: string;
          startedAt: string;
          queueDepth: number;
          idleSince?: string;
          terminationReason?: string;
          terminatedAt?: string;
          provider: ProviderName;
          thinking?: { type: string };
          effort?: string;
          model?: string;
          /** YA model id (launch alias) for keying per-model settings. */
          requestedModel?: string;
          liveness?: SessionLivenessSnapshot;
          providerRuntimeStatus?: ProviderRuntimeStatus;
          recapMode?: RecapMode;
          recapAfterSeconds?: number;
          promptSuggestionMode?: PromptSuggestionMode;
          helperSideModel?: string;
        } | null;
      }>(`/sessions/${sessionId}/process`),

    updateSessionMetadata: (
      sessionId: string,
      updates: {
        title?: string;
        archived?: boolean;
        starred?: boolean;
        parentSessionId?: string | null;
        heartbeatTurnsEnabled?: boolean;
        heartbeatTurnsAfterMinutes?: number | null;
        heartbeatTurnText?: string | null;
        heartbeatForceAfterMinutes?: number | null;
        promptSuggestionMode?: PromptSuggestionMode | null;
      },
    ) =>
      fetchJSON<{ updated: boolean }>(`/sessions/${sessionId}/metadata`, {
        method: "PUT",
        body: JSON.stringify(updates),
      }),

    cloneSession: (
      projectId: string,
      sessionId: string,
      title?: string,
      provider?: string,
      parentSessionId?: string,
    ) =>
      fetchJSON<{
        sessionId: string;
        messageCount: number;
        clonedFrom: string;
        provider: string;
      }>(`/projects/${projectId}/sessions/${sessionId}/clone`, {
        method: "POST",
        body: JSON.stringify({ title, provider, parentSessionId }),
      }),

    sendConversationContext: (
      projectId: string,
      sessionId: string,
      request: import("@yep-anywhere/shared").ConversationContextRequest,
    ) =>
      fetchJSON<import("@yep-anywhere/shared").ConversationContextReceipt>(
        `/projects/${projectId}/sessions/${sessionId}/conversation-context`,
        { method: "POST", body: JSON.stringify(request) },
      ),
  };
}

export type SessionApi = ReturnType<typeof createSessionApi>;
