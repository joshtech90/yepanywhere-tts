import { getEntry, openDatabase, putEntryWithKey } from "./diagnostics/idb";

export interface RecentComposerUpload {
  id: string;
  name: string;
  file: Blob;
  at: number;
}
export interface ComposerHistory {
  prompts: { text: string; at: number }[];
  uploads: RecentComposerUpload[];
}
const empty = (): ComposerHistory => ({ prompts: [], uploads: [] });
let database: Promise<IDBDatabase> | undefined;
const mutations = new Map<string, Promise<void>>();
function db() {
  database ??= openDatabase("ya-composer-history", 1, (value) => {
    value.createObjectStore("accounts");
  });
  return database;
}
export async function readComposerHistory(
  scope: string,
): Promise<ComposerHistory> {
  await mutations.get(scope);
  return (
    (await getEntry<ComposerHistory>(await db(), "accounts", scope)) ?? empty()
  );
}
function update(
  scope: string,
  change: (history: ComposerHistory) => void,
): Promise<void> {
  const next = (mutations.get(scope) ?? Promise.resolve()).then(async () => {
    const database = await db();
    const history =
      (await getEntry<ComposerHistory>(database, "accounts", scope)) ?? empty();
    change(history);
    await putEntryWithKey(database, "accounts", scope, history);
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
      { id, name: file.name, file, at: Date.now() },
      ...history.uploads.filter((item) => item.id !== id),
    ];
    let bytes = 0;
    history.uploads = entries.filter((entry, index) => {
      bytes += entry.file.size;
      return index < 50 && bytes <= maxBytes;
    });
  });
}
