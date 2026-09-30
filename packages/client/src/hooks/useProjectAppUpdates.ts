import { useEffect, useRef, useState } from "react";
import type { ProjectAppInfo } from "@yep-anywhere/shared";
import { projectAppApi } from "../api/projectApp";

/** `updatedAt` arrives with the server's change stamp; older servers omit it. */
type AppInfo = ProjectAppInfo & { updatedAt?: string };

/**
 * What changing the app means here: a usable declaration appearing, or a
 * newer build. A declared app whose build is missing is not there to show.
 */
function appStamp(info: AppInfo): string | null {
  if (!info.declaration && !info.activeDeclaration) return null;
  if (info.state === "missing" || info.state === "unavailable") return null;
  return info.updatedAt ?? "declared";
}

/**
 * Watches a session's project App across turns: `onUpdated` runs when a turn
 * ends with the app newly declared or rebuilt (topics/project-service.md
 * § Project App and Settings), so the user sees what they asked for without
 * finding the App button. Returns whether the project currently declares an
 * app. A server without `updatedAt` still reports a first declaration.
 */
export function useProjectAppUpdates(
  projectId: string | undefined,
  enabled: boolean,
  turnActive: boolean,
  onUpdated: () => void,
): boolean {
  const [declared, setDeclared] = useState<{ projectId: string } | null>(null);
  const baseline = useRef<{ projectId: string; stamp: string | null } | null>(
    null,
  );
  const callback = useRef(onUpdated);
  callback.current = onUpdated;

  // Read at entry and whenever a turn starts or ends: the start reading is
  // the baseline an end reading is compared with.
  useEffect(() => {
    if (!enabled || !projectId) return;
    let active = true;
    void projectAppApi
      .info(projectId)
      .then((info) => {
        if (!active) return;
        const stamp = appStamp(info);
        setDeclared(
          info.declaration || info.activeDeclaration ? { projectId } : null,
        );
        const before =
          baseline.current?.projectId === projectId ? baseline.current : null;
        if (!turnActive && before && stamp && stamp !== before.stamp)
          callback.current();
        baseline.current = { projectId, stamp };
      })
      // No app is no action; the button simply stays hidden.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId, enabled, turnActive]);

  return enabled && declared?.projectId === projectId;
}
