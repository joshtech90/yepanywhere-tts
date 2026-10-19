import { getEntry, putEntryWithKey, sharedDatabase } from "./diagnostics/idb";

export interface ComposerUploadOrigin {
  projectId?: string;
  projectName?: string;
  sessionId?: string;
  sessionTitle?: string;
}

export interface RecentComposerUpload {
  id: string;
  name: string;
  file: Blob;
  at: number;
  origin?: ComposerUploadOrigin;
}
export interface ComposerHistory {
  prompts: { text: string; at: number }[];
  uploads: RecentComposerUpload[];
}
const empty = (): ComposerHistory => ({ prompts: [], uploads: [] });
const database = sharedDatabase("ya-composer-history", 1, (db) => {
  db.createObjectStore("accounts");
});
const mutations = new Map<string, Promise<void>>();
const listeners = new Map<string, Set<() => void>>();

export function subscribeComposerHistory(
  scope: string,
  listener: () => void,
): () => void {
  const subscribers = listeners.get(scope) ?? new Set<() => void>();
  subscribers.add(listener);
  listeners.set(scope, subscribers);
  return () => {
    subscribers.delete(listener);
    if (!subscribers.size) listeners.delete(scope);
  };
}
export async function readComposerHistory(
  scope: string,
): Promise<ComposerHistory> {
  await mutations.get(scope);
  return database.run(
    async (db) =>
      (await getEntry<ComposerHistory>(db, "accounts", scope)) ?? empty(),
  );
}
function update(
  scope: string,
  change: (history: ComposerHistory) => void,
): Promise<void> {
  const next = (mutations.get(scope) ?? Promise.resolve()).then(async () => {
    await database.run(async (db) => {
      const history =
        (await getEntry<ComposerHistory>(db, "accounts", scope)) ?? empty();
      change(history);
      await putEntryWithKey(db, "accounts", scope, history);
    });
    for (const listener of listeners.get(scope) ?? []) listener();
  });
  mutations.set(scope, next);
  void next
    .finally(() => {
      if (mutations.get(scope) === next) mutations.delete(scope);
    })
    .catch(() => undefined);
  return next;
}
export function rememberComposerPrompt(
  scope: string,
  text: string,
): Promise<void> {
  if (!text.trim()) return Promise.resolve();
  return update(scope, (history) => {
    history.prompts = [
      { text, at: Date.now() },
      ...history.prompts.filter((item) => item.text !== text),
    ].slice(0, 50);
  });
}
export async function rememberComposerUpload(
  scope: string,
  file: File,
  origin?: ComposerUploadOrigin,
): Promise<void> {
  const maxBytes = 100 * 1024 * 1024;
  if (file.size > maxBytes) return;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  const id = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  await update(scope, (history) => {
    const entries = [
      { id, name: file.name, file, at: Date.now(), origin },
      ...history.uploads.filter((item) => item.id !== id),
    ];
    let bytes = 0;
    history.uploads = entries.filter((entry, index) => {
      bytes += entry.file.size;
      return index < 50 && bytes <= maxBytes;
    });
  });
}
