import { quoteShellWord } from "./posixShell.js";

// Characters that need no quoting in either cmd.exe or PowerShell when they
// follow a drive letter or path separator. `$`, spaces, parentheses, `&`, `;`,
// quotes, and similar characters force the quoted PowerShell form below.
const WINDOWS_SHELL_NEUTRAL_PATH =
  /^[A-Za-z0-9_\-.:\\/+~][A-Za-z0-9_\-.:\\/@+~]*$/;

function quotePowerShellDoubleQuoted(value: string): string {
  return `"${value
    .replace(/`/g, "``")
    .replace(/\$/g, "`$")
    .replace(/"/g, '`"')}"`;
}

/**
 * Format a copyable command line that runs `executablePath` with fixed,
 * shell-neutral arguments.
 *
 * On Windows the user may paste into either cmd.exe or PowerShell. A bare path
 * runs in both, so it is preferred. A path that needs quoting cannot be invoked
 * the same way in both shells; it uses PowerShell's call operator, the default
 * Windows terminal shell.
 */
export function formatExecutableInvocation(
  executablePath: string,
  args: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") {
    return `${quoteShellWord(executablePath)} ${args}`;
  }
  if (WINDOWS_SHELL_NEUTRAL_PATH.test(executablePath)) {
    return `${executablePath} ${args}`;
  }
  return `& ${quotePowerShellDoubleQuoted(executablePath)} ${args}`;
}
