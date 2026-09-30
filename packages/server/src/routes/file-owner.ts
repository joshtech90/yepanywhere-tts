import type { FileOwnerProject, FileOwnerResponse } from "@yep-anywhere/shared";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { Hono } from "hono";
import { PRINCIPAL_VARIABLE, type Principal } from "../auth/principal.js";
import type { Project } from "../supervisor/types.js";
import type { ProjectScanner } from "../projects/scanner.js";
import {
  createLocalResourcePathPolicy,
  isPathInsideDirectory,
} from "./local-resource-policy.js";
import { resolveProjectPath } from "./projectParam.js";

export interface FileOwnerRoutesDeps {
  scanner: ProjectScanner;
  /** The host file-access allow-set; without it every lookup is refused. */
  allowedPaths?: string[] | (() => string[]);
  includeProjects?: () => boolean;
}

interface OwnerCandidate {
  project: Pick<Project, "id" | "path">;
  /** Length of the root spelling that matched; the deepest root wins. */
  depth: number;
  relativePath: string;
}

/**
 * Pick the project that owns `file`, from its written spelling and its
 * resolved one. A project root reached through a symlink (`~/ya` for
 * `/local/.../yepanywhere`) matches on the resolved spelling. The deepest root
 * wins so a nested project claims its own files; on equal depth the project
 * the request came from wins, then the lexically first path, so the answer
 * never depends on scan order.
 */
export async function findFileOwner(
  written: string,
  resolvedFile: string,
  projects: readonly Pick<Project, "id" | "path">[],
  currentProjectPath: string,
): Promise<FileOwnerProject | null> {
  const lexicalFile = resolve(written);
  const candidates: OwnerCandidate[] = [];
  for (const project of projects) {
    const lexicalRoot = resolve(project.path);
    if (isPathInsideDirectory(lexicalFile, lexicalRoot)) {
      candidates.push({
        project,
        depth: lexicalRoot.length,
        relativePath: relative(lexicalRoot, lexicalFile),
      });
      continue;
    }
    let realRoot: string;
    try {
      realRoot = await realpath(project.path);
    } catch {
      continue;
    }
    if (isPathInsideDirectory(resolvedFile, realRoot)) {
      candidates.push({
        project,
        depth: realRoot.length,
        relativePath: relative(realRoot, resolvedFile),
      });
    }
  }
  const current = resolve(currentProjectPath);
  candidates.sort(
    (left, right) =>
      right.depth - left.depth ||
      Number(resolve(right.project.path) === current) -
        Number(resolve(left.project.path) === current) ||
      left.project.path.localeCompare(right.project.path),
  );
  const owner = candidates[0];
  if (!owner) return null;
  return {
    projectId: owner.project.id,
    projectPath: owner.project.path,
    relativePath: owner.relativePath.split(sep).join("/"),
  };
}

/**
 * `GET /api/projects/:projectId/file-owner?path=<absolute or ~/ path>`.
 * The project in the URL only authorizes the request. Naming a host path is
 * superuser-only, like every other absolute-path read, and the file must pass
 * the same allow-set check as the file endpoint; a missing or disallowed file
 * is an error, never a guessed owner.
 */
export function createFileOwnerRoutes(deps: FileOwnerRoutesDeps) {
  const routes = new Hono<{
    Variables: Record<typeof PRINCIPAL_VARIABLE, Principal>;
  }>();
  const pathPolicy =
    deps.allowedPaths !== undefined
      ? createLocalResourcePathPolicy({
          allowedPaths: deps.allowedPaths,
          scanner: deps.scanner,
          includeProjects: deps.includeProjects,
        })
      : undefined;

  routes.get("/:projectId/file-owner", async (c) => {
    const projectPath = await resolveProjectPath(c, deps.scanner);
    if (typeof projectPath !== "string") return projectPath;
    const principal = c.get(PRINCIPAL_VARIABLE) as Principal | undefined;
    if (principal && principal.kind !== "superuser") {
      return c.json({ error: "Superuser required" }, 403);
    }
    if (!pathPolicy) {
      return c.json({ error: "No file-access policy is configured" }, 403);
    }
    const requested = c.req.query("path");
    if (!requested) return c.json({ error: "path is required" }, 400);
    // `~/` is this server's home, the same expansion link discovery uses.
    const written = requested.startsWith("~/")
      ? join(homedir(), requested.slice(2))
      : requested;
    const allowed = await pathPolicy.resolveAllowedFilePath(written);
    if (!allowed.ok) return c.json({ error: allowed.error }, allowed.status);
    const response: FileOwnerResponse = {
      owner: await findFileOwner(
        written,
        allowed.file.resolvedPath,
        await deps.scanner.listProjects(),
        projectPath,
      ),
    };
    return c.json(response);
  });

  return routes;
}
