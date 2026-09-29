/** Project ids are base64url-encoded absolute project paths. */
export function cockpitProjectPathFromId(projectId: string): string | null {
  try {
    const base64 = projectId.replace(/-/g, "+").replace(/_/g, "/");
    const path = decodeURIComponent(
      Array.from(
        atob(base64),
        (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
      ).join(""),
    );
    return path.startsWith("/") ? path : null;
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * A command that continues this session in a terminal on the machine that
 * runs YA. Only providers with a known resume command get one.
 */
export function buildCockpitResumeCommand(input: {
  provider: string | undefined;
  projectId: string;
  sessionId: string;
}): string | null {
  const path = cockpitProjectPathFromId(input.projectId);
  if (!path || !/^[\w-]+$/.test(input.sessionId)) return null;
  const cd = `cd ${shellQuote(path)}`;
  if (input.provider === "codex") {
    return `${cd} && codex resume ${input.sessionId}`;
  }
  if (!input.provider || input.provider.startsWith("claude")) {
    return `${cd} && claude --resume ${input.sessionId}`;
  }
  return null;
}
