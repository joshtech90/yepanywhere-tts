/**
 * Machine-readable fields a refusal body carries beside its `error` text, so
 * a caller can act on why a request was refused without matching message
 * wording. Both HTTP transports (direct and relay) copy them onto the error
 * they throw.
 */
export interface ApiRefusalFields {
  /** Stable refusal reason, e.g. `stale-session`. */
  reason?: string;
  /**
   * Set on a `stale-session` refusal when the user may start sessions in the
   * session's project: the turn belongs in a new session seeded with a
   * handoff (topics/limited-users.md § Freshness).
   */
  staleRedirect?: "stale-handoff";
}

export function refusalFields(body: unknown): ApiRefusalFields {
  if (!body || typeof body !== "object") return {};
  const { reason, staleRedirect } = body as Record<string, unknown>;
  return {
    ...(typeof reason === "string" ? { reason } : {}),
    ...(staleRedirect === "stale-handoff" ? { staleRedirect } : {}),
  };
}

/** Whether a send was refused because its session went cold, with a redirect. */
export function isStaleSessionRedirect(error: unknown): boolean {
  const fields = error as ApiRefusalFields | null;
  return (
    fields?.reason === "stale-session" &&
    fields.staleRedirect === "stale-handoff"
  );
}
