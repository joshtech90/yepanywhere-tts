import type { HostCredentialAttempt } from "./hostStorage";
import type {
  SessionEstablishmentKind,
  StoredSession,
} from "./connection/SecureConnection";
import { resumeScopeKey } from "./rejectedResumeStorage";
import { REMOTE_CREDENTIALS_KEY } from "./storageKeys";

/** The immutable intent and the advancing compatibility mirror are separate. */
export interface LegacyCredentialOwner {
  credential: HostCredentialAttempt;
  mirrorSessionId?: string;
}

/** Call under the credential lock, only after the authoritative commit succeeds. */
export function advanceLegacyCredentialMirror(
  owner: LegacyCredentialOwner,
  session: StoredSession,
  kind: SessionEstablishmentKind,
): void {
  try {
    const raw = localStorage.getItem(REMOTE_CREDENTIALS_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw);
    const scope = {
      mode: stored.mode === "relay" ? ("relay" as const) : ("direct" as const),
      endpoint: stored.wsUrl,
      identity: stored.username,
      relayUsername: stored.mode === "relay" ? stored.relayUsername : undefined,
    };
    if (resumeScopeKey(scope) !== resumeScopeKey(owner.credential.scope))
      return;
    // A refusal may clear the mirror before full SRP establishes a new key.
    // It cannot authorize a resume or replacement of another tab's session.
    if (
      stored.session?.sessionId !== owner.mirrorSessionId &&
      !(kind === "password" && !stored.session)
    )
      return;
    localStorage.setItem(
      REMOTE_CREDENTIALS_KEY,
      JSON.stringify({ ...stored, session }),
    );
    owner.mirrorSessionId = session.sessionId;
  } catch {
    /* Optional compatibility storage cannot fail authentication. */
  }
}
