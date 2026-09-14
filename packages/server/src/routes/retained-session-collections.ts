import { basename } from "node:path";
import type { RetainedSessionCollections } from "../services/RetainedSessionCollections.js";
import {
  getEffectiveProviderUpdatedAt,
  hasUnreadProviderContent,
  latestRecapMessage,
} from "../sessions/recap-overlays.js";
import type {
  GlobalSessionItem,
  GlobalSessionStats,
  GlobalSessionsDeps,
} from "./global-sessions.js";
import {
  getActiveSessionIndexOptions,
  isSessionAutoArchived,
} from "./session-list-options.js";

export async function readRetainedSessionItems(
  service: RetainedSessionCollections,
  deps: Pick<
    GlobalSessionsDeps,
    | "sessionMetadataService"
    | "supervisor"
    | "externalTracker"
    | "notificationService"
    | "sessionAutoArchiveDays"
  >,
) {
  const { rows, catalog } = await service.read();
  const projects = new Map(
    rows.map((row) => [
      row.projectId,
      {
        id: row.projectId,
        name: row.projectName ?? basename(row.projectPath),
      },
    ]),
  );
  const cutoff = getActiveSessionIndexOptions(
    deps.sessionAutoArchiveDays,
  )?.activeAfterMs;
  const sessions: GlobalSessionItem[] = [];
  const seen = new Set<string>();
  const stats: GlobalSessionStats = {
    totalCount: 0,
    unreadCount: 0,
    starredCount: 0,
    archivedCount: 0,
    providerCounts: {},
    executorCounts: {},
  };
  for (const row of rows) {
    if (seen.has(row.sessionId)) continue;
    seen.add(row.sessionId);
    const metadata = deps.sessionMetadataService?.getMetadata(row.sessionId);
    const process = deps.supervisor?.getProcessForSession(row.sessionId);
    const projectId = metadata?.workingProjectId ?? row.projectId;
    const providerUpdatedAt = getEffectiveProviderUpdatedAt(
      row.updatedAt,
      process,
    );
    const recap = latestRecapMessage(
      deps.sessionMetadataService?.getRecapMessages(row.sessionId) ?? [],
    );
    const updatedAt =
      recap && Date.parse(recap.timestamp) > Date.parse(providerUpdatedAt)
        ? recap.timestamp
        : providerUpdatedAt;
    const pendingRequest = process?.getPendingInputRequest();
    const isArchived =
      metadata?.isArchived ?? isSessionAutoArchived({ updatedAt }, cutoff);
    const hasUnread = hasUnreadProviderContent(
      deps.notificationService,
      row.sessionId,
      providerUpdatedAt,
    );
    const provider = metadata?.provider ?? row.provider ?? row.catalogFamily;
    const item: GlobalSessionItem = {
      id: row.sessionId,
      ...(row.title !== undefined ? { title: row.title } : {}),
      updatedAt,
      ...(row.createdAt ? { createdAt: row.createdAt } : {}),
      provider,
      projectId,
      projectName:
        projects.get(projectId)?.name ??
        row.projectName ??
        basename(row.projectPath),
      ownership: process
        ? {
            owner: "self",
            processId: process.id,
            permissionMode: process.permissionMode,
            appliedPermissionMode: process.appliedPermissionMode,
            modeVersion: process.modeVersion,
            recapAfterSeconds: process.recapAfterSeconds,
          }
        : {
            owner: deps.externalTracker?.isExternal(row.sessionId)
              ? "external"
              : "none",
          },
      pendingInputType: pendingRequest
        ? pendingRequest.type === "tool-approval"
          ? "tool-approval"
          : "user-question"
        : undefined,
      activity:
        process?.state.type === "in-turn" ||
        process?.state.type === "waiting-input"
          ? process.state.type
          : process?.state.type === "idle" && process.isRetainingProviderWork()
            ? "in-turn"
            : undefined,
      hasUnread,
      isArchived,
      isStarred: metadata?.isStarred ?? false,
      customTitle: metadata?.customTitle,
      autoResumeDisabled: metadata?.autoResumeDisabled === true,
      parentSessionId: metadata?.parentSessionId,
      parentSessionKind: metadata?.parentSessionKind,
      forkedFromSessionId: metadata?.forkedFromSessionId,
      workstreamId: metadata?.workstreamId,
      executor: metadata?.executor,
      ...(row.asyncQuestions ? { asyncQuestions: row.asyncQuestions } : {}),
    };
    sessions.push(item);
    if (item.isStarred) stats.starredCount += 1;
    if (isArchived) {
      stats.archivedCount += 1;
      continue;
    }
    stats.totalCount += 1;
    if (hasUnread) stats.unreadCount += 1;
    stats.providerCounts[provider] = (stats.providerCounts[provider] ?? 0) + 1;
    const executor = item.executor ?? "local";
    stats.executorCounts[executor] = (stats.executorCounts[executor] ?? 0) + 1;
  }
  sessions.sort(
    (a, b) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      a.id.localeCompare(b.id),
  );
  return {
    sessions,
    stats,
    projects: [...projects.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    catalog,
  };
}
