import { useCallback, useEffect, useMemo, useState } from "react";
import type { ArtifactViewerStatus } from "@yep-anywhere/shared";
import { serverHasCapability, SERVER_CAPABILITIES } from "@yep-anywhere/shared";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useRetainedVersionInfo } from "./useVersion";

import type { SessionAppConfig } from "../lib/sessionVhostApps";

export function useVhostAccess(config: ArtifactViewerStatus | undefined) {
  const runtime = useCurrentSourceRuntime();
  const version = useRetainedVersionInfo(runtime.sourceKey);
  const supported = serverHasCapability(
    version,
    SERVER_CAPABILITIES.vhostBearerAccess.name,
  );
  const [state, setState] = useState<{
    source: string;
    tokens: Record<string, string | null>;
  }>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly refreshes links after revocation or access changes.
  useEffect(() => {
    if (!supported || !config) return;
    let cancelled = false;
    runtime.transport
      .fetch<{ tokens: Record<string, string | null> }>(
        "/artifacts/vhosts/links",
      )
      .then(
        ({ tokens }) => {
          if (!cancelled) {
            setState({ source: runtime.sourceKey, tokens });
            setError(undefined);
          }
        },
        (failure: unknown) => {
          if (!cancelled)
            setError(
              failure instanceof Error ? failure.message : String(failure),
            );
        },
      );
    return () => {
      cancelled = true;
    };
  }, [supported, config, runtime, revision]);
  const tokens = state?.source === runtime.sourceKey ? state.tokens : undefined;
  const resolved = useMemo(
    () =>
      config && (!supported || tokens)
        ? ({
            ...config,
            ...(supported ? { accessTokens: tokens } : {}),
          } as SessionAppConfig)
        : undefined,
    [config, supported, tokens],
  );
  return { supported, error, refresh, config: resolved };
}
