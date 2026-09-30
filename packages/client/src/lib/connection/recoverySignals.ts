/** Signals of renewed demand, shared by initial acquisition and live recovery. */
export function observeRecoverySignals(
  recover: () => void,
  includeInteraction = true,
): () => void {
  if (typeof window === "undefined") return () => {};
  const visible = () => {
    if (!document.hidden) recover();
  };
  window.addEventListener("focus", visible);
  window.addEventListener("online", visible);
  window.addEventListener("popstate", visible);
  if (includeInteraction) {
    document.addEventListener("pointerdown", visible);
    document.addEventListener("keydown", visible);
  }
  return () => {
    window.removeEventListener("focus", visible);
    window.removeEventListener("online", visible);
    window.removeEventListener("popstate", visible);
    document.removeEventListener("pointerdown", visible);
    document.removeEventListener("keydown", visible);
  };
}
