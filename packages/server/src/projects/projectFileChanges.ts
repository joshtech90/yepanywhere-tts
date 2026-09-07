import { resolve } from "node:path";

const listeners = new Set<(projectPath: string) => void>();

/** Invalidation hints from existing observers; subscribing acquires no I/O. */
export function onProjectFileChange(
  listener: (projectPath: string) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyProjectFileChange(projectPath: string): void {
  if (!listeners.size) return;
  const path = resolve(projectPath);
  for (const listener of listeners) listener(path);
}
