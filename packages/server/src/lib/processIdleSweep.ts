import { getLogger } from "../logging/logger.js";
import { runOutsideRequestContext } from "./outsideRequestContext.js";

/**
 * One process-wide, unref'd interval for owners that release idle state.
 *
 * Long-lived caches must not each start a timer (see the bounded-retention
 * rule in ARCHITECTURE.md). An owner registers a sweep callback while it holds
 * releasable state and unregisters when it holds none; the interval runs only
 * while at least one sweep is registered.
 */

export const PROCESS_IDLE_SWEEP_INTERVAL_MS = 60_000;

type IdleSweep = (now: number) => void;

const sweeps = new Set<IdleSweep>();
let timer: NodeJS.Timeout | null = null;

/** Register `sweep`; returns its idempotent unregister function. */
export function registerIdleSweep(sweep: IdleSweep): () => void {
  sweeps.add(sweep);
  if (!timer) {
    // The first registration usually happens inside a request.
    const interval = runOutsideRequestContext(() =>
      setInterval(
        () => runIdleSweeps(Date.now()),
        PROCESS_IDLE_SWEEP_INTERVAL_MS,
      ),
    );
    interval.unref();
    timer = interval;
  }
  return () => {
    sweeps.delete(sweep);
    if (sweeps.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Run every registered sweep now. Exported for tests. */
export function runIdleSweeps(now: number): void {
  for (const sweep of [...sweeps]) {
    try {
      sweep(now);
    } catch (error) {
      getLogger().warn(
        {
          event: "idle_sweep_failed",
          error: error instanceof Error ? error.message : String(error),
        },
        "Idle sweep failed",
      );
    }
  }
}
