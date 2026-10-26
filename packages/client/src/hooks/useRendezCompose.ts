import { useEffect } from "react";
import type { SourceTransport } from "../lib/transport/types";
import { generateUUID } from "../lib/uuid";

/** Visible new-session composition renews one server-arbitrated draft claim. */
export function useRendezCompose(
  transport: SourceTransport,
  projectId: string | undefined,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled || !projectId) return;
    const claimId = generateUUID();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let work = Promise.resolve();
    const visible = () =>
      !disposed &&
      document.visibilityState === "visible" &&
      transport.status.getSnapshot().state === "ready";
    const send = (acquire: boolean, release = false) => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      work = work.then(async () => {
        if (!release && !visible()) return;
        try {
          const result = await transport.fetch<{ active: boolean }>(
            "/rendez/compose",
            {
              method: "POST",
              body: JSON.stringify({
                claimId,
                projectId: release ? null : projectId,
                acquire,
              }),
            },
          );
          if (timer) clearTimeout(timer);
          timer = undefined;
          if (!release && visible() && result.active)
            timer = setTimeout(() => send(false), 15_000);
        } catch {
          // A failed renewal lets the server expire the claim; foreground or
          // reconnect is the next acquisition event, never a background retry.
        }
      });
    };
    const foreground = () => send(visible(), !visible());
    let connectionState = transport.status.getSnapshot().state;
    const reconnect = () => {
      const next = transport.status.getSnapshot().state;
      if (next === connectionState) return;
      connectionState = next;
      if (visible()) send(true);
      else send(false, true);
    };
    document.addEventListener("visibilitychange", foreground);
    window.addEventListener("focus", foreground);
    const unsubscribe = transport.status.subscribe(reconnect);
    if (visible()) send(true);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", foreground);
      window.removeEventListener("focus", foreground);
      unsubscribe();
      send(false, true);
    };
  }, [transport, projectId, enabled]);
}
