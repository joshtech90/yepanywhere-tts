/**
 * On-demand connections from one extension context to saved hosts.
 *
 * Each context (side panel, background worker) resumes the host's saved
 * session itself; nothing holds a connection for another context. An idle
 * connection closes, so a context Chrome keeps alive costs no standing
 * socket, and a worker Chrome stops simply loses its cache.
 */

import type { SecureConnection } from "../lib/connection/SecureConnection";
import type { SavedHost } from "../lib/hostStorage";
import {
  connectSavedHost,
  documentSavedHostCredentials,
  type SavedHostCredentials,
} from "../lib/savedHostConnection";

const IDLE_CLOSE_MS = 60_000;

interface Link {
  credentialKey: string;
  connection: Promise<SecureConnection>;
  abort: AbortController;
  idle?: ReturnType<typeof setTimeout>;
  users: number;
}

const links = new Map<string, Link>();

function drop(hostId: string, link: Link): void {
  if (links.get(hostId) !== link) return;
  links.delete(hostId);
  clearTimeout(link.idle);
  link.abort.abort();
  void link.connection.then(
    (connection) => connection.close(),
    () => {},
  );
}

function linkFor(host: SavedHost, credentials: SavedHostCredentials): Link {
  // A new sign-in replaces the session; its connection starts fresh.
  const credentialKey = `${host.session?.sessionId}:${host.credentialRevision}`;
  const current = links.get(host.id);
  if (current && current.credentialKey === credentialKey) return current;
  if (current) drop(host.id, current);
  const abort = new AbortController();
  // Assigned before either callback can run: both fire after a connect attempt.
  let link!: Link;
  const connection = connectSavedHost(
    host,
    abort.signal,
    undefined,
    () => drop(host.id, link),
    credentials,
  );
  link = { credentialKey, abort, users: 0, connection };
  connection.catch(() => drop(host.id, link));
  links.set(host.id, link);
  return link;
}

/** Run `use` with a connection to `host`, connecting if needed. */
export async function withHost<T>(
  host: SavedHost,
  use: (connection: SecureConnection) => Promise<T>,
  credentials: SavedHostCredentials = documentSavedHostCredentials,
): Promise<T> {
  const link = linkFor(host, credentials);
  link.users++;
  clearTimeout(link.idle);
  try {
    return await use(await link.connection);
  } finally {
    link.users--;
    if (link.users === 0 && links.get(host.id) === link)
      link.idle = setTimeout(() => drop(host.id, link), IDLE_CLOSE_MS);
  }
}

export function closeHostLinks(): void {
  for (const [hostId, link] of links) drop(hostId, link);
}
