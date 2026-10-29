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

export interface CockpitResumeTarget {
  provider: "claude" | "codex";
  projectPath: string;
  sessionId: string;
}

/** The session a terminal can continue, when its provider has a resume command. */
export function cockpitResumeTarget(input: {
  provider: string | undefined;
  projectId: string;
  sessionId: string;
}): CockpitResumeTarget | null {
  const projectPath = cockpitProjectPathFromId(input.projectId);
  if (!projectPath || !/^[A-Za-z0-9][\w-]*$/.test(input.sessionId)) return null;
  if (input.provider === "codex") {
    return { provider: "codex", projectPath, sessionId: input.sessionId };
  }
  if (!input.provider || input.provider.startsWith("claude")) {
    return { provider: "claude", projectPath, sessionId: input.sessionId };
  }
  return null;
}

/**
 * A command that continues this session in a terminal on the machine that
 * runs YA. Only providers with a known resume command get one.
 */
export function buildCockpitResumeCommand(
  target: CockpitResumeTarget | null,
): string | null {
  if (!target) return null;
  const cd = `cd ${shellQuote(target.projectPath)}`;
  return target.provider === "codex"
    ? `${cd} && codex resume ${target.sessionId}`
    : `${cd} && claude --resume ${target.sessionId}`;
}

interface MacCockpitTerminalBridge {
  postMessage: (target: CockpitResumeTarget) => Promise<unknown>;
}

/**
 * Inside the Mac app the Yep Cockpit window opens Terminal itself (over SSH
 * for the other machine). Resolves false where no app can, so the caller
 * falls back to copying the command.
 */
export async function openCockpitTerminal(
  target: CockpitResumeTarget,
): Promise<boolean> {
  const bridge = (
    window as {
      webkit?: {
        messageHandlers?: { yepTerminal?: MacCockpitTerminalBridge };
      };
    }
  ).webkit?.messageHandlers?.yepTerminal;
  if (!bridge) return false;
  try {
    return (await bridge.postMessage(target)) === true;
  } catch {
    return false;
  }
}
