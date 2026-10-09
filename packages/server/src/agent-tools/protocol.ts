import {
  isSessionClientView,
  type SessionClientView,
} from "@yep-anywhere/shared";

/** Own-session protocol; independent of the browser API and provider protocol. */
export const AGENT_SELF_VERSION = 1;
export const AGENT_SELF_PATH = "/v1/self";
export const AGENT_VIEW_PATH = "/v1/view";
export const AGENT_SELF_MAX_BYTES = 64 * 1024;

/**
 * Every client's own view of the owning session, never merged into one.
 * `selectedClientId` names the one a question about "the app" most likely
 * means: the most recently focused, else the most recently published.
 */
export interface AgentViewReport {
  schemaVersion: 1;
  observedAt: string;
  scope: "owning-session";
  sessionId: string;
  selectedClientId: string | null;
  selection: "most-recently-focused" | "most-recently-published" | "none";
  /** Most recently focused first. */
  clients: SessionClientView[];
}

/** Order clients and choose the default one; the clients stay distinct. */
export function agentViewReport(
  sessionId: string,
  clients: readonly SessionClientView[],
): AgentViewReport {
  const ordered = [...clients].sort(
    (a, b) =>
      (b.focusedAt ?? "").localeCompare(a.focusedAt ?? "") ||
      b.publishedAt.localeCompare(a.publishedAt),
  );
  const first = ordered[0];
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    scope: "owning-session",
    sessionId,
    selectedClientId: first?.clientId ?? null,
    selection: !first
      ? "none"
      : first.focusedAt
        ? "most-recently-focused"
        : "most-recently-published",
    clients: ordered,
  };
}

export function isAgentViewReport(input: unknown): input is AgentViewReport {
  if (!input || typeof input !== "object") return false;
  const report = input as Record<string, unknown>;
  if (
    report.schemaVersion !== 1 ||
    report.scope !== "owning-session" ||
    typeof report.sessionId !== "string" ||
    report.sessionId.length === 0 ||
    typeof report.observedAt !== "string" ||
    !Array.isArray(report.clients) ||
    !report.clients.every(isSessionClientView) ||
    !["most-recently-focused", "most-recently-published", "none"].includes(
      String(report.selection),
    )
  )
    return false;
  const clients = report.clients as SessionClientView[];
  return report.selectedClientId === null
    ? report.selection === "none"
    : clients.some((client) => client.clientId === report.selectedClientId);
}

export interface AgentSelfValue {
  value: string | null;
  status: "known" | "default" | "unknown";
  source: string;
  scope: "launch" | "session" | "response";
  observedAt: string;
}

export interface AgentSelfSelection {
  model?: string | null;
  effort?: string | null;
  pendingEffort?: boolean;
}

export interface AgentSelfReport {
  schemaVersion: 1;
  observedAt: string;
  scope: "owning-session";
  sessionId: string;
  launchId: string;
  launcher: "yepanywhere";
  harness: string;
  provider: string;
  launch: { model: AgentSelfValue; effort: AgentSelfValue };
  selected: { model: AgentSelfValue; effort: AgentSelfValue };
  providerEvidence: { model: AgentSelfValue; effort: AgentSelfValue };
  pending: { effort: boolean };
  activeInference: "unknown";
}

/** Reject partial/foreign responses before either output mode treats them as facts. */
export function isAgentSelfReport(input: unknown): input is AgentSelfReport {
  if (!input || typeof input !== "object") return false;
  const report = input as Record<string, unknown>;
  const field = (input: unknown): boolean => {
    if (!input || typeof input !== "object") return false;
    const item = input as Record<string, unknown>;
    return (
      (typeof item.value === "string" || item.value === null) &&
      ["known", "default", "unknown"].includes(String(item.status)) &&
      (item.status === "known"
        ? typeof item.value === "string"
        : item.value === null) &&
      typeof item.source === "string" &&
      ["launch", "session", "response"].includes(String(item.scope)) &&
      typeof item.observedAt === "string"
    );
  };
  const pair = (input: unknown): boolean => {
    if (!input || typeof input !== "object") return false;
    const item = input as Record<string, unknown>;
    return field(item.model) && field(item.effort);
  };
  return (
    report.schemaVersion === 1 &&
    report.scope === "owning-session" &&
    report.launcher === "yepanywhere" &&
    report.activeInference === "unknown" &&
    [
      report.sessionId,
      report.launchId,
      report.harness,
      report.provider,
      report.observedAt,
    ].every((value) => typeof value === "string" && value.length > 0) &&
    pair(report.launch) &&
    pair(report.selected) &&
    pair(report.providerEvidence) &&
    Boolean(
      report.pending &&
        typeof report.pending === "object" &&
        typeof (report.pending as Record<string, unknown>).effort === "boolean",
    )
  );
}

export type AgentSelfErrorCode =
  | "unavailable"
  | "unauthorized"
  | "expired"
  | "session-mismatch"
  | "session-not-ready"
  | "owner-unavailable"
  | "unsupported-protocol"
  | "invalid-response"
  | "usage";

export const AGENT_SELF_EXIT_CODES: Record<AgentSelfErrorCode, number> = {
  usage: 2,
  unavailable: 3,
  unauthorized: 4,
  expired: 4,
  "session-mismatch": 4,
  "session-not-ready": 5,
  "owner-unavailable": 5,
  "unsupported-protocol": 6,
  "invalid-response": 6,
};
