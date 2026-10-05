import { execFile } from "node:child_process";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import {
  defaultInstallation,
  verifyMacApp,
} from "../../machine-control/installation.js";
import type {
  AgentSession,
  ProviderName,
  StartSessionOptions,
} from "./types.js";

const exec = promisify(execFile);

export interface NativeSudoDependencies {
  platform?: string;
  environment?: NodeJS.ProcessEnv;
  verify?: (app: string, team: string) => Promise<string>;
}

/** Operator-selected installation, independently supplied publisher, and
 * native code verification. An agent-supplied path is never a launch option. */
export async function verifyNativeSudo(
  app: string,
  team: string,
): Promise<string> {
  const resources = await verifyMacApp(app, team);
  const run = async (command: string, args: string[]) =>
    exec(command, args, { timeout: 15_000, maxBuffer: 64 * 1024 });
  const requirement = `anchor apple generic and certificate leaf[subject.OU] = "${team}"`;
  for (const [name, identifier] of [
    ["mc-sudo", "org.machine-control.sudo"],
    ["mc-sudo-askpass", "org.machine-control.sudo.askpass"],
  ] as const) {
    await run("/usr/bin/codesign", [
      "--verify",
      "--strict",
      "-R",
      `=${requirement} and identifier "${identifier}"`,
      join(resources, name),
    ]);
  }
  return resources;
}

export async function startNativeSudoSession(
  provider: ProviderName,
  options: StartSessionOptions,
  start: (options: StartSessionOptions) => Promise<AgentSession>,
  dependencies: NativeSudoDependencies = {},
): Promise<AgentSession> {
  const environment = dependencies.environment ?? process.env;
  const platform = dependencies.platform ?? process.platform;
  const app =
    environment.YEP_MC_SUDO_APP ??
    (environment.YEP_MC_SUDO === "1" && platform === "darwin"
      ? (environment.YEP_MC_APP ?? defaultInstallation(platform, environment))
      : undefined);
  if (
    !app ||
    platform !== "darwin" ||
    options.executor ||
    options.sessionSandbox ||
    options.sessionSandboxOptions?.level === "project-write" ||
    options.permissionMode === "plan" ||
    !["codex", "claude", "claude-gateway", "claude-ollama"].includes(
      provider,
    ) ||
    (provider === "codex" && options.permissionMode !== "bypassPermissions")
  ) {
    return start(options);
  }
  const team = environment.YEP_MC_SUDO_TEAM_ID ?? environment.YEP_MC_TEAM_ID;
  if (!team) {
    throw new Error(
      "Native sudo requires YEP_MC_SUDO_TEAM_ID from a trusted publisher source",
    );
  }
  let directory: string;
  try {
    directory = await (dependencies.verify ?? verifyNativeSudo)(app, team);
  } catch {
    throw new Error(
      "Configured native sudo installation failed publisher or integrity verification",
    );
  }
  const helper = join(directory, "mc-sudo");
  // An exact quoted path still works if a provider's login shell restores PATH.
  const quoted = `'${helper.replaceAll("'", "'\\''")}'`;
  const instructions = [
    "[Native administrator authentication]",
    `For a command needing administrator privileges, use ${quoted} -- COMMAND ARGUMENTS... instead of sudo.`,
    "It requests a native password dialog on this Mac for one invocation. Wait for the person to authenticate or cancel; the default authentication timeout is 120 seconds.",
    "Never request, read, print, or pass the login password through tools, stdin, arguments, environment, or chat. Cancellation, timeout, authentication failure, and unsupported desktop state are terminal for that invocation; report them without automatically retrying.",
    "This does not arm a session or bypass OS policy. Command descendants may also have administrator privileges.",
  ].join("\n");
  return start({
    ...options,
    globalInstructions: [options.globalInstructions, instructions]
      .filter(Boolean)
      .join("\n\n"),
    agentEnvironment: {
      ...options.agentEnvironment,
      PATH: [directory, options.agentEnvironment?.PATH ?? environment.PATH]
        .filter(Boolean)
        .join(delimiter),
    },
  });
}
