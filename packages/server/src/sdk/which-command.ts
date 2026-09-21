/**
 * Platform-appropriate command to locate an executable in PATH: `where` on
 * Windows, `which` elsewhere.
 *
 * This module deliberately imports nothing, so the CLI entry point can use it
 * before `checkServerRuntime()` has decided whether this runtime can load the
 * rest of the server.
 */
export function whichCommand(
  name: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? `where ${name}` : `which ${name}`;
}
