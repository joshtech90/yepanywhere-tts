import { useSyncExternalStore } from "react";
import { UI_KEYS } from "../lib/storageKeys";

export type AttachmentAction = "auto" | "menu" | "files" | "memo";
const listeners = new Set<() => void>();
function read(): AttachmentAction {
  const value = localStorage.getItem(UI_KEYS.attachmentAction);
  return value === "menu" || value === "files" || value === "memo"
    ? value
    : "auto";
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
export function useAttachmentAction() {
  const action = useSyncExternalStore(subscribe, read);
  return [
    action,
    (next: AttachmentAction) => {
      localStorage.setItem(UI_KEYS.attachmentAction, next);
      for (const listener of listeners) listener();
    },
  ] as const;
}
