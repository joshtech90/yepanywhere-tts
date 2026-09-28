import {
  SERVER_CAPABILITIES,
  serverHasCapability,
  type SessionCreationProvenance,
} from "@yep-anywhere/shared";
import type { VersionInfo } from "../api/serverMetadataClient";
import { getClientVersion } from "./clientVersion";
import { getDesktopRuntimeMetadata } from "./desktopRuntime";

export function getUiCreationProvenance(
  versionInfo: VersionInfo | null | undefined,
): SessionCreationProvenance | undefined {
  if (
    !serverHasCapability(
      versionInfo,
      SERVER_CAPABILITIES.sessionCreationProvenance.name,
    )
  ) {
    return undefined;
  }
  const desktopRuntime = getDesktopRuntimeMetadata();
  return {
    surface: desktopRuntime ? "desktop" : "web",
    clientOrigin: window.location.origin,
    clientVersion: getClientVersion(),
    ...(desktopRuntime?.commit ? { clientCommit: desktopRuntime.commit } : {}),
  };
}
