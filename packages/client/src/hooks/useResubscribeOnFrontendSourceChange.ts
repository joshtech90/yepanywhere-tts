import { useEffect } from "react";
import { activityBus } from "../lib/activityBus";

/** Restart a live session subscription when Vite notifies frontend-changed. */
export function useResubscribeOnFrontendSourceChange(reconnect: () => void) {
  useEffect(() => {
    return activityBus.on("source-change", (event) => {
      if (event.target !== "frontend") return;
      reconnect();
    });
  }, [reconnect]);
}
