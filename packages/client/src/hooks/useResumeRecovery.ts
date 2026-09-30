import { useEffect, useRef } from "react";
import { observeRecoverySignals } from "../lib/connection/recoverySignals";

/** Initial acquisition only. Attached transports own their own recovery. */
export function useResumeRecovery(enabled: boolean, retry: () => void): void {
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const lastAttempt = useRef(-Infinity);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requested = false;
    const recover = () => {
      if (
        requested ||
        document.hidden ||
        Date.now() - lastAttempt.current < 5000
      )
        return;
      requested = true;
      lastAttempt.current = Date.now();
      retryRef.current();
    };
    const schedule = () => {
      clearTimeout(timer);
      if (document.hidden || requested) return;
      timer = setTimeout(recover, 60000 * (1 + Math.random() * 0.3));
    };
    const visibility = () => {
      if (!document.hidden) recover();
      schedule();
    };
    // Initial acquisition shows action buttons. Do not start a retry on
    // pointerdown/keydown and unmount those buttons before their click fires.
    const unsubscribe = observeRecoverySignals(recover, false);
    document.addEventListener("visibilitychange", visibility);
    schedule();
    return () => {
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled]);
}
