import {
  SESSION_SCOPED_LOCAL_FILES_CAPABILITY,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { useMemo } from "react";
import { useOptionalSessionMetadata } from "../contexts/SessionMetadataContext";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useRetainedVersionInfo } from "./useVersion";

/**
 * The session a file path was named in, when the server reads paths as that
 * session sees them: a sandboxed session's /tmp is its private one, and a
 * limited user may read only through a session (capability
 * `session-scoped-local-files`; topics/session-sandboxing.md). Older servers
 * and views outside a session keep the host-wide doors.
 */
export interface LocalFileScope {
  sessionId: string;
}

export function useLocalFileScope(): LocalFileScope | undefined {
  const sessionId = useOptionalSessionMetadata()?.sessionId;
  const runtime = useCurrentSourceRuntime();
  const version = useRetainedVersionInfo(runtime.sourceKey);
  const supported = serverHasCapability(
    version,
    SESSION_SCOPED_LOCAL_FILES_CAPABILITY,
  );
  return useMemo(
    () => (sessionId && supported ? { sessionId } : undefined),
    [sessionId, supported],
  );
}
