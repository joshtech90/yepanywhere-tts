import type {
  SessionClientView,
  SessionViewPublication,
} from "@yep-anywhere/shared";

/** Tabs per session, then sessions; the least recently reported goes first. */
const MAX_CLIENTS_PER_SESSION = 8;
const MAX_SESSIONS = 512;

/**
 * Each tab's last reported view of each session, held in memory only.
 *
 * Contract: topics/agent-self.md § View inspection. Entries are never merged
 * across clients and are not expired by a timer: a closed tab that could not
 * report its departure stays with its last `publishedAt`, which readers use
 * to judge staleness. Every change hands the session's full list to
 * `onChange`; nothing is written to disk.
 */
export class SessionViewRegistry {
  private readonly sessions = new Map<string, Map<string, SessionClientView>>();

  constructor(
    private readonly onChange: (
      sessionId: string,
      views: readonly SessionClientView[],
    ) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  publish(sessionId: string, publication: SessionViewPublication): void {
    const at = this.now().toISOString();
    const clients = this.sessions.get(sessionId) ?? new Map();
    const previous = clients.get(publication.clientId);
    clients.delete(publication.clientId);
    clients.set(publication.clientId, {
      ...publication,
      publishedAt: at,
      focusedAt: publication.focused ? at : (previous?.focusedAt ?? null),
    });
    for (const clientId of clients.keys()) {
      if (clients.size <= MAX_CLIENTS_PER_SESSION) break;
      clients.delete(clientId);
    }
    this.sessions.delete(sessionId);
    this.sessions.set(sessionId, clients);
    for (const id of this.sessions.keys()) {
      if (this.sessions.size <= MAX_SESSIONS) break;
      this.sessions.delete(id);
    }
    this.onChange(sessionId, this.views(sessionId));
  }

  /** A tab left the session; it no longer shows anything there. */
  depart(sessionId: string, clientId: string): void {
    const clients = this.sessions.get(sessionId);
    if (!clients?.delete(clientId)) return;
    if (clients.size === 0) this.sessions.delete(sessionId);
    this.onChange(sessionId, this.views(sessionId));
  }

  views(sessionId: string): SessionClientView[] {
    return [...(this.sessions.get(sessionId)?.values() ?? [])];
  }
}
