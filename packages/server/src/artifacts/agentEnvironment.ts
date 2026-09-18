/**
 * Artifact origin published into an agent session, or nothing.
 *
 * A capture tool otherwise has to ask `/api/version` whether interactive
 * artifact delivery is configured, and the answer belongs to the user's YA
 * server rather than to the sandbox the agent runs in. Publishing the origin
 * lets the tool decide without that round trip, and its absence is the
 * images-only signal.
 *
 * Only the local origin is published, and only to a child that reaches YA over
 * loopback. The local artifact origin resolves on the YA host, so naming it to
 * a remote executor would assert a service that child cannot reach; those
 * sessions fall back to asking the server.
 */
import { vhostSessionEnvironment } from "./vhosts.js";

export const ARTIFACT_VIEWER_ORIGIN_ENV = "AGENT_ARTIFACT_VIEWER_ORIGIN";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

function isLoopbackUrl(value: string): boolean {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function artifactViewerAgentEnvironment(
  server: {
    available: boolean;
    config: {
      localOrigin?: string;
      vhosts?: { env?: string; port: number }[];
    };
  },
  serverUrl: string | undefined,
  executor?: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  const origin = server.config.localOrigin;
  const onLoopback = Boolean(serverUrl && isLoopbackUrl(serverUrl));
  if (server.available && origin && onLoopback)
    env[ARTIFACT_VIEWER_ORIGIN_ENV] = origin;
  if (!executor && (!serverUrl || onLoopback)) {
    Object.assign(env, vhostSessionEnvironment(server.config.vhosts ?? []));
  }
  return env;
}
