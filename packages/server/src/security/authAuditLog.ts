import type { Context } from "hono";
import { getLogger } from "../logging/logger.js";
import { getAuthenticatedSrpTransport } from "../middleware/authenticated-transport.js";
import { createAuditLog } from "./auditLog.js";

/**
 * Authentication and account changes, in `<dataDir>/logs/auth-events.jsonl`
 * and the server log (topics/security.md § Authentication audit). Entries are
 * built only from the fields below: a password, hash, cookie or token is never
 * one of them.
 */
export type AuthAuditEvent =
  | "login"
  | "logout"
  | "auth-setup"
  | "auth-enable"
  | "auth-disable"
  | "password-change"
  | "password-reset-cli"
  | "localhost-access"
  | "user-switch"
  | "user-create"
  | "user-update"
  | "user-delete"
  | "remote-access-configure"
  | "remote-access-enable"
  | "remote-access-disable"
  | "remote-access-clear"
  | "remote-access-relay";

export interface AuthAuditFields {
  event: AuthAuditEvent;
  outcome: "success" | "failure";
  /** Account the event is about: `owner` or a limited username. */
  account?: string;
  /** Short machine-readable cause of a failure. */
  reason?: string;
  /** Non-secret facts, such as which fields an update changed. */
  details?: Record<string, string | number | boolean>;
}

export interface AuthAuditEntry extends AuthAuditFields {
  timestamp: string;
  transport: "direct" | "relay" | "cli";
  clientAddress?: string;
  userAgent?: string;
}

const authAuditLog = createAuditLog<AuthAuditEntry>({
  fileName: "auth-events.jsonl",
  maxBytes: 10 * 1024 * 1024,
  label: "[auth-audit]",
});

let auditDataDir: string | undefined;

/** Where the audit file lives; unset, events reach only the server log. */
export function configureAuthAudit(dataDir: string | undefined): void {
  auditDataDir = dataDir;
}

function requestFacts(
  c: Context | undefined,
): Pick<AuthAuditEntry, "transport" | "clientAddress" | "userAgent"> {
  if (!c) return { transport: "cli" };
  const incoming = (
    c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  )?.incoming;
  const userAgent = c.req.header("User-Agent");
  return {
    transport: getAuthenticatedSrpTransport(c.env) ? "relay" : "direct",
    ...(incoming?.socket?.remoteAddress
      ? { clientAddress: incoming.socket.remoteAddress }
      : {}),
    ...(userAgent ? { userAgent: userAgent.slice(0, 200) } : {}),
  };
}

/**
 * Record one authentication event. `c` is the request it came from; omit it
 * for the command line. Never throws: a failed write is reported and the
 * action it records proceeds.
 */
export async function recordAuthEvent(
  c: Context | undefined,
  fields: AuthAuditFields,
): Promise<void> {
  const entry: AuthAuditEntry = {
    timestamp: new Date().toISOString(),
    event: fields.event,
    outcome: fields.outcome,
    ...(fields.account ? { account: fields.account } : {}),
    ...(fields.reason ? { reason: fields.reason } : {}),
    ...(fields.details ? { details: fields.details } : {}),
    ...requestFacts(c),
  };
  try {
    getLogger().info({ ...entry, event: "auth_event", auth: entry.event });
  } catch {
    // Logging is best effort; the audit file below is the record.
  }
  try {
    await authAuditLog.append(auditDataDir, entry);
  } catch (error) {
    console.error("[auth-audit] Failed to record auth event:", error);
  }
}
