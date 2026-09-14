import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quoteShellWord } from "../../utils/posixShell.js";

const AGENTCTL_SESSION_ID_ENV = "AGENTCTL_SESSION_ID";
const ORIGINAL_BASH_ENV_ENV = "YEP_ORIGINAL_BASH_ENV";
/**
 * Session-scoped names the bridge file owns. `extendEnv` drops them from a
 * spawn environment so a reused process cannot inherit a previous session's
 * values; the bridge writes the current ones back for each shell.
 */
const SESSION_CHILD_ENV_NAMES = [
  "AGENT_SERVER_URL",
  "AGENT_ARTIFACT_VIEWER_ORIGIN",
  "YEP_SESSION_WAKE_URL",
  "YEP_SESSION_WAKE_TOKEN",
  "YEP_BROWSER_DEBUG_AGENT_URL",
  "YEP_BROWSER_DEBUG_CALLER_TOKEN",
] as const;
/**
 * The subset whose value is the same for every session on this server, so it
 * survives the provider-runtime-host boundary: the host narrows the computed
 * child environment to these names before handing it to the worker, which has
 * no other way to learn them. Keep this a subset of the names above, and keep
 * genuinely per-session values (the minted wake token and its URL) out of it.
 */
const STATIC_AGENT_ENV_NAMES = [
  "AGENT_SERVER_URL",
  "AGENT_ARTIFACT_VIEWER_ORIGIN",
  "YEP_BROWSER_DEBUG_AGENT_URL",
  "YEP_BROWSER_DEBUG_CALLER_TOKEN",
] as const;

export interface AgentctlSessionEnvBridge {
  readonly bashEnvPath: string;
  extendEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  publishSessionId(
    sessionId: string,
    browserDebugEnvironment?: Record<string, string>,
  ): void;
  cleanup(): void;
}

export function pickStaticAgentEnvironment(
  environment: Record<string, string> | NodeJS.ProcessEnv | undefined,
): Record<string, string> {
  return Object.fromEntries(
    STATIC_AGENT_ENV_NAMES.flatMap((name) => {
      const value = environment?.[name];
      return typeof value === "string" && value ? [[name, value]] : [];
    }),
  );
}

export function createAgentctlSessionEnvBridge(
  initialSessionId?: string,
  getSessionEnv?: (sessionId: string) => Record<string, string>,
): AgentctlSessionEnvBridge {
  const dir = mkdtempSync(join(tmpdir(), "ya-agentctl-session-"));
  const bashEnvPath = join(dir, "bash-env.sh");
  const sessionEnvPath = join(dir, "agentctl-session.env");

  const writeBashEnv = (environment: NodeJS.ProcessEnv) =>
    writeFileSync(
      bashEnvPath,
      [
        "# yep-anywhere agentctl session bridge",
        // Capture the original file at launch. A shared environment variable
        // would point an outer bridge back at itself in a nested YA launch.
        ...(environment.BASH_ENV
          ? [
              `if [ -r ${quoteShellWord(environment.BASH_ENV)} ]; then`,
              `  . ${quoteShellWord(environment.BASH_ENV)}`,
              "fi",
            ]
          : []),
        // An inherited startup file can restore an outer YA capability after
        // child filtering. Reassert only this launch's self grant, even before
        // the canonical session-id file exists.
        ...["AGENT_YA_API_URL", "AGENT_YA_API_TOKEN"].map((name) =>
          environment[name]
            ? `export ${name}=${quoteShellWord(environment[name])}`
            : `unset ${name}`,
        ),
        `if [ -r ${quoteShellWord(sessionEnvPath)} ]; then`,
        `  . ${quoteShellWord(sessionEnvPath)}`,
        "fi",
        "",
      ].join("\n"),
      { encoding: "utf-8", mode: 0o600 },
    );

  writeBashEnv({});

  const publishSessionId = (
    sessionId: string,
    browserDebugEnvironment?: Record<string, string>,
  ): void => {
    const tempPath = join(dir, "agentctl-session.env.tmp");
    const sessionEnv = {
      [AGENTCTL_SESSION_ID_ENV]: sessionId,
      ...getSessionEnv?.(sessionId),
      ...pickStaticAgentEnvironment(browserDebugEnvironment),
    };
    writeFileSync(
      tempPath,
      [
        ...Object.entries(sessionEnv).flatMap(([name, value]) => {
          if (!/^[A-Z_][A-Z0-9_]*$/u.test(name)) {
            throw new Error(`Invalid child environment variable name: ${name}`);
          }
          return [`${name}=${quoteShellWord(value)}`, `export ${name}`];
        }),
        "",
      ].join("\n"),
      { encoding: "utf-8", mode: 0o600 },
    );
    renameSync(tempPath, sessionEnvPath);
  };

  if (initialSessionId) {
    publishSessionId(initialSessionId);
  }

  return {
    bashEnvPath,
    extendEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
      writeBashEnv(env);
      const extended: NodeJS.ProcessEnv = {
        ...env,
        ...(env.BASH_ENV
          ? { [ORIGINAL_BASH_ENV_ENV]: env.BASH_ENV }
          : undefined),
        BASH_ENV: bashEnvPath,
      };
      for (const name of SESSION_CHILD_ENV_NAMES) delete extended[name];
      return extended;
    },
    publishSessionId,
    cleanup(): void {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Install the Bash bridge path onto a child overlay or the worker process
 * environment without stripping session-scoped values from `target` itself.
 * `extendEnv` still drops those names from the object it returns so a full
 * spawn env cannot leak a stale wake/debug pair; this helper only copies the
 * bridge path and an already-known resume id.
 */
export function copyAgentctlBashEnvInto(
  target: NodeJS.ProcessEnv | Record<string, string>,
  bridge: AgentctlSessionEnvBridge,
  options?: { sessionId?: string; baseEnv?: NodeJS.ProcessEnv },
): void {
  const bridged = bridge.extendEnv({
    ...(options?.baseEnv ?? process.env),
    ...target,
  });
  if (typeof bridged.BASH_ENV === "string" && bridged.BASH_ENV) {
    target.BASH_ENV = bridged.BASH_ENV;
  }
  if (
    typeof bridged.YEP_ORIGINAL_BASH_ENV === "string" &&
    bridged.YEP_ORIGINAL_BASH_ENV
  ) {
    target.YEP_ORIGINAL_BASH_ENV = bridged.YEP_ORIGINAL_BASH_ENV;
  } else {
    delete target.YEP_ORIGINAL_BASH_ENV;
  }
  if (options?.sessionId) {
    target.AGENTCTL_SESSION_ID = options.sessionId;
  }
}
