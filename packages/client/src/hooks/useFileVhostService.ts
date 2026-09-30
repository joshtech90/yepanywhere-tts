import {
  SERVER_CAPABILITIES,
  serverHasCapability,
  type ArtifactVhostSiteView,
} from "@yep-anywhere/shared";
import { useMemo } from "react";
import type { FileVhostService } from "../components/FileVhostSection";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useActingPrincipal } from "./useActingPrincipal";
import { useRetainedVersionInfo } from "./useVersion";

/**
 * File vhost requests for the current source, or null where they cannot be
 * offered: a server without `vhost-file-sites`, a principal that is not the
 * superuser (the routes are administrator settings), or no hostname to serve
 * at because neither a public root nor local app serving is configured.
 */
export function useFileVhostService(
  /** Resolves project-relative paths, as the File Viewer names files. */
  projectId?: string,
): FileVhostService | null {
  const { sourceKey, transport } = useCurrentSourceRuntime();
  const version = useRetainedVersionInfo(sourceKey);
  const { principal, resolved } = useActingPrincipal();
  const status = version?.artifactViewer;
  const hostSuffix =
    status?.vhostPublicRoot ?? (status?.localOrigin ? "localhost" : undefined);
  const supported =
    serverHasCapability(version, SERVER_CAPABILITIES.vhostFileSites.name) &&
    resolved &&
    principal.username === null &&
    !status?.locked;
  return useMemo(
    () =>
      supported && hostSuffix
        ? {
            hostSuffix,
            list: async (path) =>
              (
                await transport.fetch<{ sites: ArtifactVhostSiteView[] }>(
                  `/artifacts/vhost-sites?${new URLSearchParams({
                    path,
                    ...(projectId ? { projectId } : {}),
                  })}`,
                )
              ).sites,
            serve: (site) =>
              transport.fetch<ArtifactVhostSiteView>("/artifacts/vhost-sites", {
                method: "POST",
                body: JSON.stringify({
                  ...site,
                  ...(projectId ? { projectId } : {}),
                }),
              }),
            stop: async (name) => {
              await transport.fetch(
                `/artifacts/vhost-sites/${encodeURIComponent(name)}`,
                { method: "DELETE" },
              );
            },
          }
        : null,
    [supported, hostSuffix, transport, projectId],
  );
}
