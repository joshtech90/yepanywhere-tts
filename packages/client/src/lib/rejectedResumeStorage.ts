import type { StoredSession } from "./connection/SecureConnection";
import {
  emitResumeObservation,
  type ResumeObservation,
} from "./resumeDiagnostics";
import { SAVED_HOSTS_KEY, UI_KEYS } from "./storageKeys";
import { generateUUID } from "./uuid";

// Deliberately outside the portable settings allowlist and active credential schema.
export const REJECTED_RESUME_KEY = "yep-anywhere-rejected-srp-resume-v1";
const GENERATION_KEY = "yep-anywhere-rejected-srp-resume-generation";
const ACTIVE_KEY = "yep-anywhere-remote-credentials";
const LOCK = "yep-anywhere-rejected-srp-resume";
export const RESUME_RETENTION_MS = 72 * 60 * 60 * 1000;
export interface ResumeScope {
  mode: "direct" | "relay";
  endpoint: string;
  identity: string;
  relayUsername?: string;
}
interface RetainedResume {
  id: string;
  scope: ResumeScope;
  session: StoredSession;
  quarantinedAt: number;
  expiresAt: number;
  observations: ResumeObservation[];
}
const eraseListeners = new Set<() => void>();
export function retentionEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      JSON.parse(localStorage.getItem(UI_KEYS.developerMode) ?? "{}")
        .retainRejectedSrpSessions === true
    );
  } catch {
    return false;
  }
}
export function resumeGeneration(): string {
  if (typeof window === "undefined") return "0";
  try {
    return localStorage.getItem(GENERATION_KEY) ?? "0";
  } catch {
    return "unavailable";
  }
}
export function resumeScopeKey(scope: ResumeScope): string {
  return JSON.stringify([
    scope.mode,
    scope.endpoint,
    scope.identity,
    scope.relayUsername ?? "",
  ]);
}
export function scopeForHost(host: {
  mode: "direct" | "relay";
  wsUrl?: string;
  relayUrl?: string;
  srpUsername: string;
  relayUsername?: string;
}): ResumeScope {
  return {
    mode: host.mode,
    endpoint: (host.mode === "relay" ? host.relayUrl : host.wsUrl) ?? "",
    identity: host.srpUsername,
    relayUsername: host.mode === "relay" ? host.relayUsername : undefined,
  };
}
function validString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2048;
}
function read(): RetainedResume[] {
  const raw = localStorage.getItem(REJECTED_RESUME_KEY);
  if (!raw || raw.length > 128 * 1024) return [];
  try {
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1 || !Array.isArray(parsed.records)) return [];
    return parsed.records
      .filter(
        (r: RetainedResume) =>
          r &&
          validString(r.id) &&
          r.scope &&
          (r.scope.mode === "direct" || r.scope.mode === "relay") &&
          validString(r.scope.endpoint) &&
          validString(r.scope.identity) &&
          (r.scope.mode !== "relay" || validString(r.scope.relayUsername)) &&
          r.session &&
          validString(r.session.sessionId) &&
          validString(r.session.sessionKey) &&
          typeof r.session.wsUrl === "string" &&
          r.session.wsUrl.length <= 2048 &&
          r.session.username === r.scope.identity &&
          (r.scope.mode !== "direct" || r.session.wsUrl === r.scope.endpoint) &&
          (r.session.resumeProtocolVersion === undefined ||
            (Number.isInteger(r.session.resumeProtocolVersion) &&
              r.session.resumeProtocolVersion >= 1)) &&
          Number.isFinite(r.quarantinedAt) &&
          r.quarantinedAt <= Date.now() &&
          r.expiresAt === r.quarantinedAt + RESUME_RETENTION_MS &&
          r.expiresAt > Date.now() &&
          Array.isArray(r.observations),
      )
      .slice(-8);
  } catch {
    return [];
  }
}
function write(records: RetainedResume[]): void {
  if (records.length)
    localStorage.setItem(
      REJECTED_RESUME_KEY,
      JSON.stringify({ version: 1, records }),
    );
  else localStorage.removeItem(REJECTED_RESUME_KEY);
}
async function coordinated<T>(fn: () => T): Promise<T | undefined> {
  if (typeof navigator === "undefined" || !navigator.locks) return undefined;
  return navigator.locks.request(LOCK, fn);
}
/** Active credential writers participate in the same lock as retirement. */
export async function mutateResumeCredentials<T>(fn: () => T): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    let ran = false;
    try {
      return await navigator.locks.request(LOCK, () => {
        ran = true;
        return fn();
      });
    } catch (error) {
      if (ran) throw error;
      // Unavailable coordination must not prevent normal password authentication.
    }
  }
  return fn();
}
function same(scope: ResumeScope, candidate: ResumeScope): boolean {
  return resumeScopeKey(scope) === resumeScopeKey(candidate);
}
/** Remove only the exact attempted session. Synchronous read/compare/write protects newer logins. */
function removeActive(scope: ResumeScope, sessionId: string): void {
  const raw = localStorage.getItem(ACTIVE_KEY);
  if (raw) {
    const c = JSON.parse(raw);
    const candidate: ResumeScope = {
      mode: c.mode === "relay" ? "relay" : "direct",
      endpoint: c.wsUrl,
      identity: c.username,
      relayUsername: c.relayUsername,
    };
    if (same(scope, candidate) && c.session?.sessionId === sessionId) {
      delete c.session;
      localStorage.setItem(ACTIVE_KEY, JSON.stringify(c));
    }
  }
  const hostsRaw = localStorage.getItem(SAVED_HOSTS_KEY);
  if (hostsRaw) {
    const data = JSON.parse(hostsRaw);
    if (data.version !== 1 || !Array.isArray(data.hosts)) return;
    let changed = false;
    for (const host of data.hosts) {
      if (
        same(scope, scopeForHost(host)) &&
        host.session?.sessionId === sessionId
      ) {
        delete host.session;
        changed = true;
      }
    }
    if (changed) localStorage.setItem(SAVED_HOSTS_KEY, JSON.stringify(data));
  }
}
export async function retireRejectedResume(
  scope: ResumeScope,
  session: StoredSession,
  observations: ResumeObservation[],
  generation: string,
  isCurrent: () => boolean,
): Promise<void> {
  if (typeof window === "undefined") return;
  const event = observations.at(-1);
  if (!event || (event.event !== "rejected" && event.event !== "incompatible"))
    return;
  const transition = (canRetain: boolean) => {
    if (!isCurrent()) {
      emitResumeObservation({ ...event, event: "superseded" });
      return;
    }
    try {
      if (
        canRetain &&
        retentionEnabled() &&
        generation === resumeGeneration()
      ) {
        const records = read();
        const prior = records.find(
          (r) =>
            same(scope, r.scope) && r.session.sessionId === session.sessionId,
        );
        const now = Date.now();
        const record: RetainedResume = {
          id: prior?.id ?? generateUUID(),
          scope,
          session: { ...session },
          quarantinedAt: prior?.quarantinedAt ?? now,
          expiresAt: prior?.expiresAt ?? now + RESUME_RETENTION_MS,
          observations: [...(prior?.observations ?? []), ...observations].slice(
            -8,
          ),
        };
        write(
          [...records.filter((r) => !same(scope, r.scope)), record].slice(-8),
        );
        emitResumeObservation({ ...event, event: "quarantined" });
      } else if (retentionEnabled() && !canRetain)
        emitResumeObservation({ ...event, event: "coordination_unavailable" });
    } catch {
      emitResumeObservation({ ...event, event: "storage_failure" });
    }
    try {
      removeActive(scope, session.sessionId);
    } catch {
      emitResumeObservation({ ...event, event: "storage_failure" });
    }
  };
  try {
    if (typeof navigator !== "undefined" && navigator.locks)
      await coordinated(() => transition(true));
    else transition(false);
  } catch {
    transition(false);
  }
}
export function safeResumeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "invalid_endpoint";
  }
}
// Project every field explicitly; corrupted local data must not leak a key via metadata.
export function listRetainedResumes() {
  if (!retentionEnabled()) return [];
  void coordinated(() => {
    try {
      write(read());
    } catch {
      /* unavailable storage */
    }
  }).catch(() => {});
  try {
    return read().map((r) => ({
      id: r.id,
      mode: r.scope.mode,
      endpoint: safeResumeEndpoint(r.scope.endpoint),
      identity: r.scope.identity.slice(0, 256),
      relayUsername: r.scope.relayUsername?.slice(0, 256),
      sessionId: r.session.sessionId.slice(0, 256),
      protocolVersion: r.session.resumeProtocolVersion,
      quarantinedAt: r.quarantinedAt,
      expiresAt: r.expiresAt,
      observations: r.observations.slice(-8).map((o) => ({
        attemptId: String(o.attemptId).slice(0, 256),
        sessionId: r.session.sessionId.slice(0, 256),
        phase: [
          "connecting",
          "srp_resume_init_sent",
          "srp_resume_proof_sent",
          "authenticated",
          "failed",
        ].includes(o.phase)
          ? o.phase
          : "unknown",
        event: [
          "started",
          "challenge",
          "proof",
          "authenticated",
          "rejected",
          "incompatible",
          "timeout",
          "verification",
          "protocol",
          "server",
        ].includes(o.event)
          ? o.event
          : "unknown",
        at: Number(o.at),
        elapsedMs: Number(o.elapsedMs),
        clientVersion: String(o.clientVersion).slice(0, 64),
        protocolVersion: r.session.resumeProtocolVersion,
      })),
    }));
  } catch {
    return [];
  }
}
/** Internal to debugger probes. Never expose this object through the console API. */
export async function acquireRetainedResume(id: string) {
  return coordinated(() => {
    if (!retentionEnabled()) return undefined;
    const records = read();
    write(records);
    return records.find((r) => r.id === id);
  });
}
export async function appendResumeProbeEvidence(
  id: string,
  generation: string,
  observations: ResumeObservation[],
): Promise<void> {
  await coordinated(() => {
    if (!retentionEnabled() || generation !== resumeGeneration()) return;
    const records = read();
    const record = records.find((r) => r.id === id);
    if (record)
      record.observations = [...record.observations, ...observations].slice(-8);
    write(records);
  });
}
/** Synchronous tombstone precedes queued erasure: late handshakes cannot resurrect keys. */
export function forgetRetainedResumes(
  scope?: ResumeScope,
  id?: string,
  allIdentities = false,
): void {
  const matches = (r: RetainedResume) =>
    scope
      ? same(
          allIdentities ? { ...scope, identity: r.scope.identity } : scope,
          r.scope,
        )
      : id
        ? r.id === id
        : true;
  try {
    localStorage.setItem(GENERATION_KEY, generateUUID());
    void coordinated(() => {
      write(read().filter((r) => !matches(r)));
    }).catch(() => {});
    // Immediate removal also works when locks are unavailable or preference is disabled.
    write(read().filter((r) => !matches(r)));
  } catch {
    /* No raw storage exceptions in diagnostics. */
  }
  for (const listener of eraseListeners) listener();
}
export function subscribeResumeErasure(listener: () => void): () => void {
  eraseListeners.add(listener);
  return () => {
    eraseListeners.delete(listener);
  };
}
export function initResumeRetention(): () => void {
  const prune = () => {
    // Pruning/erasure still runs if coordination is unavailable; it never adds keys.
    void mutateResumeCredentials(() => {
      try {
        if (!retentionEnabled()) localStorage.removeItem(REJECTED_RESUME_KEY);
        else write(read());
      } catch {
        /* unavailable storage */
      }
    }).catch(() => {});
  };
  const storage = (event: StorageEvent) => {
    if (
      event.key === GENERATION_KEY ||
      event.key === UI_KEYS.developerMode ||
      event.key === null
    ) {
      for (const listener of eraseListeners) listener();
      prune();
    }
  };
  prune();
  window.addEventListener("storage", storage);
  return () => window.removeEventListener("storage", storage);
}
