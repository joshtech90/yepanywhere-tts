import { randomUUID } from "node:crypto";
import {
  isDesktopControlOrigin,
  nativeMachineControl,
  type NativeMachineControl,
} from "../../desktop/machine-control.js";
import { RETIRED_COMPUTER_CONTROL_ERROR } from "../../machine-control/legacy-retirement.js";
import { delimiter, win32 } from "node:path";
import {
  defaultInstallation,
  verifyInstalledMachineControl,
  type InstalledMachineControl,
} from "../../machine-control/installation.js";
import { startNativeSudoSession } from "./native-sudo.js";
import type {
  AgentSession,
  ProviderName,
  StartSessionOptions,
} from "./types.js";

export interface MachineControlDependencies {
  delegation?: NativeMachineControl;
  platform?: string;
  environment?: NodeJS.ProcessEnv;
  verify?: (
    installation: string,
    publisher: string | undefined,
    platform: NodeJS.Platform,
  ) => Promise<InstalledMachineControl>;
}

/** Advertisement is launcher context, never an MC grant or OS containment. */
export async function startMachineControlSession(
  provider: ProviderName,
  options: StartSessionOptions,
  start: (options: StartSessionOptions) => Promise<AgentSession>,
  dependencies: MachineControlDependencies = {},
): Promise<AgentSession> {
  if (options.computerControl) throw new Error(RETIRED_COMPUTER_CONTROL_ERROR);
  const environment = dependencies.environment ?? process.env;
  const platform = dependencies.platform ?? process.platform;
  const selected = options.machineControl ?? environment.YEP_MC_CONTROL === "1";
  if (
    !selected ||
    !["darwin", "win32", "linux"].includes(platform) ||
    options.executor ||
    options.sessionSandbox ||
    options.sessionSandboxOptions?.level === "project-write" ||
    options.permissionMode === "plan" ||
    !["codex", "claude", "claude-gateway", "claude-ollama"].includes(
      provider,
    ) ||
    (provider === "codex" && options.permissionMode !== "bypassPermissions")
  )
    return start(options);
  const app =
    environment.YEP_MC_APP ?? defaultInstallation(platform, environment);
  const publisher =
    platform === "darwin"
      ? environment.YEP_MC_TEAM_ID
      : environment.YEP_MC_PUBLISHER;
  let installation: InstalledMachineControl;
  try {
    installation = await (dependencies.verify ?? verifyInstalledMachineControl)(
      app,
      publisher,
      platform as NodeJS.Platform,
    );
  } catch {
    throw new Error(
      "Configured Machine Control desktop installation is missing, incompatible, or failed publisher/integrity verification",
    );
  }
  const candidate =
    platform === "darwin" &&
    installation.desktopDelegation === true &&
    isDesktopControlOrigin(options.desktopControlOrigin)
      ? (dependencies.delegation ?? nativeMachineControl())
      : undefined;
  const delegation =
    candidate && (await candidate.enabled()) ? candidate : undefined;
  const quoted =
    platform === "win32"
      ? `& '${installation.command.replaceAll("'", "''")}'`
      : `'${installation.command.replaceAll("'", "'\\''")}'`;
  const fragment = [
    "[Installed Machine Control]",
    `Machine Control ${installation.version} is available on this agent's execution host.`,
    `For desktop/browser control, first read its workflow with: ${quoted} agent instructions`,
    `Invoke that exact command path if your shell replaces PATH. The host target is this execution machine.`,
    "Discovery and these instructions grant no access. Follow MC doctor/claims and native access approval; do not start a second resident, switch to the operator's machine, or automatically retry an uncertain mutation.",
    delegation
      ? "Native YA delegation is bound to this live local provider. Use MC control call/ControlSession for owner-bound ordinary desktop work. Closing this session ends its delegated tasks; separately approved target-wide MC access remains independent."
      : "Closing this YA session does not revoke independently granted MC access. Use MC Stop or native grant expiry to revoke it.",
    "MC owns its access, arming, lifecycle and updates. YA session selection only advertises the command; it does not contain unrelated same-user shell access. Administrator authentication is a separately selected helper.",
  ].join("\n");
  const generation = randomUUID();
  const sessionId = options.desktopControlOrigin?.launch ?? randomUUID();
  const proxy = delegation ? await delegation.pathname() : undefined;
  const session = await start({
    ...options,
    globalInstructions: [options.globalInstructions, fragment]
      .filter(Boolean)
      .join("\n\n"),
    agentEnvironment: {
      ...options.agentEnvironment,
      ...(proxy ? { MACHINE_CONTROL_DESKTOP_PROXY: proxy } : {}),
      ...(platform === "win32"
        ? {
            MACHINE_CONTROL_DESKTOP_INSTALL_DIR: win32.dirname(
              installation.root,
            ),
          }
        : {}),
      PATH: [
        installation.directory,
        options.agentEnvironment?.PATH ?? environment.PATH,
      ]
        .filter(Boolean)
        .join(delimiter),
    },
  });
  if (delegation) {
    try {
      await delegation.bind(session, sessionId, generation);
    } catch (error) {
      await session.abort();
      throw error;
    }
  }
  return session;
}

export function startMachineControlToolsSession(
  provider: ProviderName,
  options: StartSessionOptions,
  start: (options: StartSessionOptions) => Promise<AgentSession>,
) {
  return startMachineControlSession(provider, options, (resolved) =>
    startNativeSudoSession(provider, resolved, start),
  );
}
