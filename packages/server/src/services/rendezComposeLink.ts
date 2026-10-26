import { randomUUID } from "node:crypto";
import { lstat, rename, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";

export const RENDEZ_COMPOSE_ROUTE = "ya-new-session-draft";

/** Atomically select the active compose destination without changing latest-session. */
export async function publishComposeLink(
  root: string,
  active: boolean,
): Promise<void> {
  const link = join(root, "active-compose");
  try {
    if (!(await lstat(link)).isSymbolicLink())
      throw new Error("Rendez active-compose destination must be a symlink");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = join(root, `.compose-${randomUUID()}`);
  await symlink(
    active ? join("routes", RENDEZ_COMPOSE_ROUTE, "inbox") : "latest-session",
    temporary,
    "dir",
  );
  try {
    await rename(temporary, link);
  } catch (error) {
    await unlink(temporary);
    throw error;
  }
}
