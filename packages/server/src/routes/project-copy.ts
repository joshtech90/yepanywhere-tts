import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isUrlProjectId } from "@yep-anywhere/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { principalFor } from "../auth/limitedLaunchPolicy.js";
import type { ProjectScanner } from "../projects/scanner.js";
import { expandHomePath } from "../utils/expandHomePath.js";
import {
  decideProjectCreation,
  isContainedOnDisk,
} from "./project-creation.js";

/** Bounds on one copy, so a view grant cannot fill the disk. */
export const PROJECT_COPY_LIMITS = {
  bytes: 512 * 1024 * 1024,
  entries: 50_000,
};

/** Rebuilt by the copy's own setup, and usually most of a project's bytes. */
const SKIPPED_NAMES = new Set(["node_modules"]);

const copyRequest = z.strictObject({
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, "Use letters, digits, . _ -"),
});

class CopyLimitError extends Error {}

/**
 * Copy the working tree at `source` to the new directory `destination`:
 * regular files and directories only, skipping `node_modules`, symbolic
 * links (which could name anything on the host) and special files.
 */
export async function copyProjectTree(
  source: string,
  destination: string,
  limits = PROJECT_COPY_LIMITS,
): Promise<void> {
  let bytes = 0;
  let entries = 0;
  const filter = async (from: string) => {
    if (SKIPPED_NAMES.has(path.basename(from))) return false;
    const stats = await fs.lstat(from);
    if (!stats.isFile() && !stats.isDirectory()) return false;
    entries += 1;
    bytes += stats.isFile() ? stats.size : 0;
    if (entries > limits.entries || bytes > limits.bytes)
      throw new CopyLimitError(
        `Project is too large to copy (limit ${Math.round(limits.bytes / 1024 / 1024)} MB, ${limits.entries} files)`,
      );
    return true;
  };
  // `destination` is an empty directory this copy owns, and fs.cp refuses
  // an existing target, so the source's entries are copied into it.
  for (const name of await fs.readdir(source)) {
    const from = path.join(source, name);
    if (!(await filter(from))) continue;
    await fs.cp(from, path.join(destination, name), {
      recursive: true,
      errorOnExist: true,
      force: false,
      // The entry itself was counted above.
      filter: (nested) => (nested === from ? true : filter(nested)),
    });
  }
}

/**
 * "Make my own copy": anyone who can see a project may copy its working tree
 * into their own project directory, where the copy is theirs to change.
 *
 * Contract: topics/limited-users.md § Project copy. A limited user's copy
 * lands under their configured project directory; the superuser's beside the
 * source. The response names the new directory, which the client then adds
 * through the ordinary add-project route, so the copy is registered, owned
 * and granted exactly as a project they added themselves.
 */
export function createProjectCopyRoutes(deps: {
  scanner: Pick<ProjectScanner, "getProject">;
}) {
  const routes = new Hono();

  routes.post("/projects/:projectId/copy", async (c) => {
    const projectId = c.req.param("projectId");
    if (!projectId || !isUrlProjectId(projectId))
      throw new HTTPException(404, { message: "Project not found" });
    const source = await deps.scanner.getProject(projectId);
    if (!source) throw new HTTPException(404, { message: "Project not found" });
    const parsed = copyRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Expected a name" },
        400,
      );

    const principal = principalFor(c);
    const root =
      principal.kind === "limited"
        ? principal.grants.projectRoot
        : path.dirname(source.path);
    if (!root)
      return c.json({ error: "This user may not create projects" }, 403);
    const destination = path.join(
      path.resolve(expandHomePath(root)),
      parsed.data.name,
    );
    const decision = await decideProjectCreation(c, destination);
    if (decision.kind === "denied")
      return c.json({ error: decision.error }, 403);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    // Checked again now the parent exists: a link swapped in under the root
    // must not receive the copy.
    if (
      decision.owner &&
      !(await isContainedOnDisk(decision.owner.projectRoot, destination))
    )
      return c.json({ error: "Copy escapes the project directory" }, 403);
    // Claimed exclusively, so the cleanup below only ever removes a
    // directory this request made.
    try {
      await fs.mkdir(destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        return c.json({ error: `${parsed.data.name} already exists` }, 409);
      throw error;
    }

    try {
      await copyProjectTree(source.path, destination);
    } catch (error) {
      await fs.rm(destination, { recursive: true, force: true });
      if (error instanceof CopyLimitError)
        return c.json({ error: error.message }, 413);
      throw error;
    }
    return c.json({ path: destination }, 201);
  });

  return routes;
}
