import type { SessionSandboxEnforcement } from "@yep-anywhere/shared";
import type { SessionSandboxRuntime } from "./session-sandbox.js";

/**
 * The model-facing statement of the boundary an enforced sandbox installed.
 * Agents otherwise take a provider-native "disable sandbox" option for a way
 * out and verify a listener from inside their own namespace, then report a
 * URL the user cannot open. Today's facts only: it neither discourages
 * serving inside the sandbox nor promises a way to reach such a server.
 *
 * Kept apart from session-sandbox.ts, which resolves its launcher path from
 * its own module URL at load: the provider adapters import this, and they are
 * loaded by client tests whose module URLs are not file URLs.
 */
export function describeSessionSandboxForAgent(
  enforcement: SessionSandboxEnforcement,
): string | undefined {
  if (
    enforcement.state !== "enforced" ||
    enforcement.effective !== "project-write"
  ) {
    return undefined;
  }
  const lines = [
    "[Session sandbox]",
    "YA runs this entire provider process, including every tool call and every process it starts, inside a Linux sandbox. Provider-native options that turn off a tool's own sandbox, such as a Bash tool's dangerouslyDisableSandbox, do not leave this one: nothing you run executes outside it, so do not offer host-side previews.",
    "Writes outside the project directory fail. /tmp is private to this sandbox.",
  ];
  lines.push(
    enforcement.networkFirewall
      ? "The network loopback is private to this sandbox, and the YA server and other host services are unreachable from it. A server you start here is not reachable directly from the user's browser or an SSH forward, but YA can show it to the user: print its http://127.0.0.1:<port>/ URL from a command, for example with echo, and YA offers it in the session's App pane through this sandbox. YA looks for app URLs in command output, not in your reply. Do not claim to verify host reachability from inside the sandbox."
      : "Networking is shared with the host.",
  );
  return lines.join("\n");
}

/** Append the sandbox statement, when there is one, to launch context. */
export function withSessionSandboxAgentContext(
  globalInstructions: string | undefined,
  sessionSandbox: Pick<SessionSandboxRuntime, "enforcement"> | undefined,
): string | undefined {
  const statement =
    sessionSandbox &&
    describeSessionSandboxForAgent(sessionSandbox.enforcement);
  if (!statement) return globalInstructions;
  return globalInstructions
    ? `${globalInstructions}\n\n${statement}`
    : statement;
}
