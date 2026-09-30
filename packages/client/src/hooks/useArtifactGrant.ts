import {
  serverHasCapability,
  SERVER_CAPABILITIES,
  type ArtifactViewerGrant,
} from "@yep-anywhere/shared";
import { useEffect, useState } from "react";
import { useLocalFileScope } from "./useLocalFileScope";
import { usePublicShareContext } from "../contexts/PublicShareContext";
import { useOptionalSessionMetadata } from "../contexts/SessionMetadataContext";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import {
  artifactAudience,
  artifactOrigin,
  probeArtifactOrigin,
} from "../lib/artifactPreview";
import { useRetainedVersionInfo } from "./useVersion";

export interface ArtifactGrantState {
  /** Configured artifact origin for this client, or undefined when unusable. */
  origin: string | undefined;
  grant: ArtifactViewerGrant | null;
  busy: boolean;
  failed: boolean;
  /** The page's frame-src policy rejected the artifact origin. */
  frameBlocked: boolean;
}

/**
 * Resolve an artifact grant for one file on the configured artifact origin.
 * `attempt` 0 holds no grant; each increment probes the origin and admits a
 * fresh grant. Public shares and servers without the capability never resolve.
 */
export function useArtifactGrant(
  path: string,
  projectId: string | undefined,
  attempt: number,
): ArtifactGrantState {
  const runtime = useCurrentSourceRuntime();
  const version = useRetainedVersionInfo(runtime.sourceKey);
  const share = usePublicShareContext();
  const config = version?.artifactViewer;
  const audience = artifactAudience(window.location.hostname);
  const origin =
    config &&
    share === null &&
    serverHasCapability(version, SERVER_CAPABILITIES.artifactViewer.name)
      ? artifactOrigin(config, audience, window.location.href)
      : undefined;
  // Inside a session, preview the file as that session names it (a sandboxed
  // session's /tmp is its own, and a limited user may preview only through a
  // session); the session route takes the absolute path.
  const fileScope = useLocalFileScope();
  const sessionProjectPath = useOptionalSessionMetadata()?.projectPath;
  const sessionPath = !fileScope
    ? undefined
    : path.startsWith("/") || path.startsWith("~")
      ? path
      : sessionProjectPath
        ? `${sessionProjectPath.replace(/\/+$/, "")}/${path}`
        : undefined;
  const [grant, setGrant] = useState<ArtifactViewerGrant | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [frameBlocked, setFrameBlocked] = useState(false);

  useEffect(() => {
    setGrant(null);
    setFailed(false);
    setBusy(false);
    setFrameBlocked(false);
    if (!attempt || !origin) return;
    let cancelled = false;
    let admitted: ArtifactViewerGrant | undefined;
    const onPolicyViolation = (event: SecurityPolicyViolationEvent) => {
      if (
        admitted &&
        event.disposition === "enforce" &&
        event.effectiveDirective === "frame-src" &&
        (event.blockedURI === origin ||
          event.blockedURI.startsWith(`${origin}/`))
      ) {
        setFrameBlocked(true);
      }
    };
    document.addEventListener("securitypolicyviolation", onPolicyViolation);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    setBusy(true);
    // A reused grant may be running in another viewer or tab; only a grant
    // minted for this request is this request's to take back.
    const revokeUnpublished = (grant: ArtifactViewerGrant) => {
      if (grant.reused) return;
      void runtime.transport
        .fetch(`/artifacts/${encodeURIComponent(grant.id)}`, {
          method: "DELETE",
        })
        .catch(() => {});
    };
    void (async () => {
      try {
        await probeArtifactOrigin(origin, controller.signal);
        clearTimeout(timer);
        if (cancelled) return;
        admitted = await runtime.transport.fetch<ArtifactViewerGrant>(
          sessionPath
            ? `/sessions/${encodeURIComponent(fileScope?.sessionId ?? "")}/artifacts`
            : "/artifacts",
          {
            method: "POST",
            body: JSON.stringify(
              sessionPath
                ? { path: sessionPath, audience }
                : { path, projectId, audience },
            ),
          },
        );
        if (new URL(admitted.url).origin !== origin) {
          revokeUnpublished(admitted);
          throw new Error("Unexpected artifact origin");
        }
        if (cancelled) {
          revokeUnpublished(admitted);
          return;
        }
        setGrant(admitted);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        clearTimeout(timer);
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener(
        "securitypolicyviolation",
        onPolicyViolation,
      );
    };
  }, [
    attempt,
    origin,
    audience,
    path,
    projectId,
    runtime,
    sessionPath,
    fileScope,
  ]);

  return { origin, grant, busy, failed, frameBlocked };
}
