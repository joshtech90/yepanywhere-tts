import { existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { UrlProjectId } from "@yep-anywhere/shared";
import type { Context } from "hono";
import { type Principal, PRINCIPAL_VARIABLE } from "../auth/principal.js";
import type { SessionMetadataService } from "../metadata/index.js";
import { decodeProjectId } from "../projects/paths.js";
import { sandboxPrivateTempDirs } from "../session-sandbox.js";
import { expandHomePath } from "../utils/expandHomePath.js";

/**
 * A path as one session named it, resolved on the host, with the files the
 * acting principal may read through that session.
 */
export interface SessionPathScope {
  hostPath: string;
  allowedPaths: () => string[];
  includeProjects: () => boolean;
}

export type SessionPathScopeResolver = (
  c: Context,
  requestedPath: string,
  /** Retained source-session identity; the caller must first authorize it. */
  sessionId?: string,
) => SessionPathScope | { status: 404; error: string };

/** `path` under `root`, re-rooted at `hostRoot`; null when it is not under it. */
function reroot(path: string, root: string, hostRoot: string): string | null {
  if (path === root) return hostRoot;
  const rest = relative(root, path);
  if (!rest || rest.startsWith("..") || isAbsolute(rest)) return null;
  return join(hostRoot, rest);
}

/**
 * Resolve paths as a session sees them (topics/session-sandboxing.md,
 * § Runtime state and scratch space). A sandboxed session's /tmp and /var/tmp
 * are private directories under its sandbox state, so a path it printed there
 * names a different file on the host; everything else is the same path.
 *
 * A limited user may read through a session only its project and its
 * sandbox's private temp directories, never the host-wide file allow-set the
 * superuser's reads use; the session itself is already one they may read
 * (the limited-user middleware judged the session in the path).
 */
export function createSessionPathScopeResolver(deps: {
  sessionMetadataService?: Pick<SessionMetadataService, "getMetadata">;
  sandboxStateRoot: string;
  allowedPaths: () => string[];
  includeProjects: () => boolean;
}): SessionPathScopeResolver {
  return (c, requestedPath, sessionId = c.req.param("sessionId") ?? "") => {
    const metadata = deps.sessionMetadataService?.getMetadata(sessionId);
    const principal = c.get(PRINCIPAL_VARIABLE) as Principal | undefined;
    const sandboxed =
      metadata?.sandboxLevel === "project-write" && metadata.sandboxStateKey;
    const temp = sandboxed
      ? sandboxPrivateTempDirs(
          join(deps.sandboxStateRoot, metadata.sandboxStateKey as string),
        )
      : undefined;

    let projectPath = metadata?.sandboxProjectPath;
    if (!projectPath && metadata?.workingProjectId) {
      try {
        projectPath = decodeProjectId(
          metadata.workingProjectId as UrlProjectId,
        );
      } catch {
        projectPath = undefined;
      }
    }

    const expanded = expandHomePath(requestedPath);
    // The sandbox binds the project at its own path, over its private /tmp,
    // so a path in the project is the project's even when it lies under /tmp.
    const inProject =
      projectPath !== undefined &&
      reroot(expanded, projectPath, projectPath) !== null;
    const hostPath =
      (temp &&
        !inProject &&
        (reroot(expanded, "/tmp", temp.tempDir) ??
          reroot(expanded, "/var/tmp", temp.varTempDir))) ||
      expanded;
    const tempRoots = temp
      ? [temp.tempDir, temp.varTempDir].filter((dir) => existsSync(dir))
      : [];

    if (principal?.kind !== "limited") {
      return {
        hostPath,
        allowedPaths: () => [...deps.allowedPaths(), ...tempRoots],
        includeProjects: deps.includeProjects,
      };
    }

    if (!projectPath) {
      return { status: 404, error: "Session not found" };
    }
    const confined = [projectPath, ...tempRoots];
    return {
      hostPath,
      allowedPaths: () => confined,
      includeProjects: () => false,
    };
  };
}
