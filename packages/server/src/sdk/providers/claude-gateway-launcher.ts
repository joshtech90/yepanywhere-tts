/**
 * Optional process owner for a locally configured Claude Gateway.
 *
 * The configured shell command is powerful by design, so this boundary is
 * deliberately narrow: YA runs it only for a recognized loopback URL and only
 * after proving that the URL's TCP port has no listener. Catalog reads are the
 * only launch trigger; there is no recurring retry loop.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createConnection } from "node:net";
import {
  isLoopbackGatewayUrl,
  loopbackGatewayHostname,
} from "@yep-anywhere/shared";
import { getLogger } from "../../logging/logger.js";
import {
  identifySignallableListener,
  portListenerControlAvailable,
  stopIdentifiedListener,
} from "../../utils/portListener.js";
import { stripYaControlPlaneCredentials } from "./env-filter.js";

const DEFAULT_PROBE_TIMEOUT_MS = 500;
const DEFAULT_READINESS_TIMEOUT_MS = 10_000;
const DEFAULT_READINESS_POLL_MS = 100;
const DEFAULT_STOP_GRACE_MS = 2_000;
/**
 * A stop request gets this long to take effect before YA re-probes the port.
 * Generous on purpose: a service that waits for its own last client to go idle
 * should finish on its own terms rather than be signalled.
 */
const DEFAULT_STOP_VERIFY_DELAY_MS = 30_000;
/** A status verb answers fast; anything still running is the server itself. */
const DEFAULT_STATUS_PROBE_TIMEOUT_MS = 3_000;

export interface ClaudeGatewayLaunchConfig {
  url?: string;
  startCommand?: string;
}

export interface ClaudeGatewayLauncherOptions {
  /** Resolves a gateway URL to a base URL pinned to the address that answered. */
  probe?: (url: string) => Promise<string | null>;
  spawnCommand?: (command: string) => ChildProcess;
  signalChild?: (child: ChildProcess, signal: NodeJS.Signals) => void;
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  readinessTimeoutMs?: number;
  readinessPollMs?: number;
  stopGraceMs?: number;
  /** How long a stop request has before YA checks the port again. */
  stopVerifyDelayMs?: number;
  /** Signals the process listening on a port; true when the port went free. */
  stopListener?: (port: number) => Promise<boolean>;
  /** How long `<command> status` has to exit before it counts as the server. */
  statusProbeTimeoutMs?: number;
}

interface OwnedChild {
  child: ChildProcess;
  generation: number;
  closed: boolean;
  /** Exit status once closed; null for a signal or an `error` event. */
  exitCode: number | null;
  closedPromise: Promise<void>;
}

/** How a configured service command must be invoked. */
export type GatewayCommandStyle = "verbs" | "bare" | "unknown";

interface LaunchAttempt {
  generation: number;
  promise: Promise<string | null>;
}

/**
 * Loopback addresses to probe for a `localhost` URL, in resolution preference
 * order. Probing is concurrent; the preference only decides which answering
 * address is returned, so a dual-stack gateway is pinned consistently.
 */
const LOOPBACK_PROBE_HOSTS = ["127.0.0.1", "::1"];

export { isLoopbackGatewayUrl as isClaudeGatewayLoopbackUrl };

function connectToHost(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const settle = (listening: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
    socket.setTimeout(timeoutMs, () => settle(false));
  });
}

/** The TCP port a gateway URL names, including the scheme's default. */
export function gatewayUrlPort(rawUrl: string): number | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.port) return Number.parseInt(url.port, 10);
    return url.protocol === "https:" ? 443 : 80;
  } catch {
    return undefined;
  }
}

/**
 * Signal whatever is listening on a loopback port, with the same guards Apps
 * use: a unique, same-user listener that is not YA or one of its ancestors.
 */
async function stopGatewayPortListener(port: number): Promise<boolean> {
  if (!portListenerControlAvailable) return false;
  const identity = await identifySignallableListener(port);
  if (!identity) return true;
  return stopIdentifiedListener(port, identity);
}

/** Rewrite a gateway URL onto a specific address, preserving port and path. */
function pinnedBaseUrl(rawUrl: string, host: string): string {
  const url = new URL(rawUrl);
  url.hostname = host.includes(":") ? `[${host}]` : host;
  const pinned = url.toString();
  return pinned.endsWith("/") ? pinned.slice(0, -1) : pinned;
}

/**
 * Resolve which loopback address is actually serving a gateway URL.
 *
 * Returns a base URL pinned to the address that answered, so the caller's
 * request lands on the listener the probe just proved. A server that binds one
 * address family leaves the other family's socket free on the same port, so
 * `localhost` can front two unrelated gateways at once — one stale — and an
 * unpinned client picks between them per request. Null means nothing answered
 * (or the URL is not loopback, which this launcher does not own).
 */
export async function resolveClaudeGatewayEndpoint(
  rawUrl: string,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<string | null> {
  const loopbackHostname = loopbackGatewayHostname(rawUrl);
  if (!loopbackHostname) return null;

  const url = new URL(rawUrl);
  const port = url.port
    ? Number.parseInt(url.port, 10)
    : url.protocol === "https:"
      ? 443
      : 80;
  const hosts =
    loopbackHostname === "localhost" || loopbackHostname === "localhost."
      ? LOOPBACK_PROBE_HOSTS
      : [loopbackHostname];
  const reachable = await Promise.all(
    hosts.map((host) => connectToHost(host, port, timeoutMs)),
  );
  for (const [index, host] of hosts.entries()) {
    if (reachable[index]) return pinnedBaseUrl(rawUrl, host);
  }
  return null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

function spawnGatewayCommand(command: string): ChildProcess {
  return spawn("bash", ["-c", command], {
    cwd: process.cwd(),
    env: stripYaControlPlaneCredentials(process.env),
    detached: process.platform !== "win32",
    stdio: ["ignore", "inherit", "inherit"],
  });
}

function signalGatewayChild(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }
    child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // The process has already exited.
    }
  }
}

function configKey(config: ClaudeGatewayLaunchConfig): string {
  return `${config.url ?? ""}\n${config.startCommand ?? ""}`;
}

/**
 * A configured command written as `<script> start` states its own contract:
 * the trailing verb documents that this is a service script, so YA strips it
 * and uses the verb forms throughout — `start`, `status`, and `stop` — without
 * probing or falling back to running the bare script as a foreground server.
 */
export function interpretServiceCommand(raw: string | undefined): {
  command: string | undefined;
  style: GatewayCommandStyle;
} {
  const trimmed = raw?.trim();
  if (!trimmed) return { command: undefined, style: "unknown" };
  const match = /^(.*\S)\s+start$/u.exec(trimmed);
  return match
    ? { command: match[1], style: "verbs" }
    : { command: trimmed, style: "unknown" };
}

function normalizeConfig(
  config: ClaudeGatewayLaunchConfig,
): ClaudeGatewayLaunchConfig {
  const { command } = interpretServiceCommand(config.startCommand);
  return {
    url: config.url,
    startCommand: command,
  };
}

export class ClaudeGatewayLauncher {
  private readonly probe: (url: string) => Promise<string | null>;
  private readonly spawnCommand: (command: string) => ChildProcess;
  private readonly signalChild: (
    child: ChildProcess,
    signal: NodeJS.Signals,
  ) => void;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly readinessTimeoutMs: number;
  private readonly readinessPollMs: number;
  private readonly stopGraceMs: number;
  private readonly stopVerifyDelayMs: number;
  private readonly statusProbeTimeoutMs: number;
  private commandStyle: GatewayCommandStyle = "unknown";
  private readonly stopListener: (port: number) => Promise<boolean>;
  private stopVerification: ReturnType<typeof setTimeout> | undefined;

  private config: ClaudeGatewayLaunchConfig = {};
  private currentConfigKey = configKey(this.config);
  private generation = 0;
  private ownedChild: OwnedChild | undefined;
  private launchAttempt: LaunchAttempt | undefined;
  private configurationReady: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(options: ClaudeGatewayLauncherOptions = {}) {
    this.probe = options.probe ?? resolveClaudeGatewayEndpoint;
    this.spawnCommand = options.spawnCommand ?? spawnGatewayCommand;
    this.signalChild = options.signalChild ?? signalGatewayChild;
    this.wait = options.delay ?? delay;
    this.now = options.now ?? Date.now;
    this.readinessTimeoutMs =
      options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
    this.readinessPollMs = options.readinessPollMs ?? DEFAULT_READINESS_POLL_MS;
    this.stopGraceMs = options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
    this.stopVerifyDelayMs =
      options.stopVerifyDelayMs ?? DEFAULT_STOP_VERIFY_DELAY_MS;
    this.stopListener = options.stopListener ?? stopGatewayPortListener;
    this.statusProbeTimeoutMs =
      options.statusProbeTimeoutMs ?? DEFAULT_STATUS_PROBE_TIMEOUT_MS;
  }

  async configure(config: ClaudeGatewayLaunchConfig): Promise<void> {
    const normalized = normalizeConfig(config);
    const nextKey = configKey(normalized);
    if (nextKey === this.currentConfigKey) {
      await this.configurationReady;
      return;
    }

    this.generation += 1;
    this.config = normalized;
    this.currentConfigKey = nextKey;
    this.commandStyle = interpretServiceCommand(config.startCommand).style;
    this.clearStopVerification();
    const previousTransition = this.configurationReady;
    const transition = (async () => {
      await previousTransition;
      await this.stopOwnedChild();
    })();
    this.configurationReady = transition;
    await transition;
  }

  /**
   * Ensure a configured local endpoint has a listener.
   *
   * Returns the base URL pinned to the address that answered — callers must
   * send their request there rather than to the configured URL, so it reaches
   * the listener readiness was proven against. Null means the endpoint is not
   * a loopback endpoint this launcher owns, or nothing answered and no bounded
   * launch attempt made it ready; the caller then uses the configured URL.
   */
  async ensureReady(config: ClaudeGatewayLaunchConfig): Promise<string | null> {
    if (this.disposed) return null;
    await this.configure(config);

    const { url, startCommand } = this.config;
    const generation = this.generation;
    if (!url || !isLoopbackGatewayUrl(url)) return null;
    const listening = await this.probe(url);
    if (listening) return listening;
    if (!startCommand) return null;
    if (generation !== this.generation || this.disposed) return null;

    if (this.launchAttempt?.generation === generation) {
      return this.launchAttempt.promise;
    }

    const promise = this.launchAndWait(url, startCommand, generation);
    const attempt = { generation, promise };
    this.launchAttempt = attempt;
    try {
      return await promise;
    } finally {
      if (this.launchAttempt === attempt) {
        this.launchAttempt = undefined;
      }
    }
  }

  /**
   * Ask the service to stop, then verify.
   *
   * A stop request is a request: a service that defers shutdown until its last
   * client goes idle answers immediately while the port stays open, and that
   * is not a failure. YA therefore re-probes once after a delay and only then
   * signals the listener — which also covers a command with no `stop` verb,
   * since an unrecognized argument leaves the port exactly as it was.
   */
  async stopService(): Promise<void> {
    if (this.disposed) return;
    const { url, startCommand } = this.config;
    if (!url || !isLoopbackGatewayUrl(url)) return;

    if (this.ownedChild) {
      await this.stopOwnedChild();
    } else if (startCommand) {
      await this.runStopCommand(startCommand, url);
    } else {
      // Nothing to ask and nothing owned: an externally managed listener is
      // not YA's to kill.
      return;
    }
    this.scheduleStopVerification(url, this.generation);
  }

  private async runStopCommand(
    startCommand: string,
    url: string,
  ): Promise<void> {
    let child: ChildProcess;
    try {
      child = this.spawnCommand(`${startCommand} stop`);
    } catch (error) {
      getLogger().warn(
        { error, gatewayUrl: url },
        "Failed to run configured gateway stop command",
      );
      return;
    }
    const entry = this.trackChild(child, this.generation);
    await this.waitForClose(entry, this.readinessTimeoutMs);
    if (this.ownedChild === entry) this.ownedChild = undefined;
  }

  private scheduleStopVerification(url: string, generation: number): void {
    this.clearStopVerification();
    const timer = setTimeout(() => {
      this.stopVerification = undefined;
      void this.verifyStopped(url, generation);
    }, this.stopVerifyDelayMs);
    timer.unref();
    this.stopVerification = timer;
  }

  private clearStopVerification(): void {
    if (!this.stopVerification) return;
    clearTimeout(this.stopVerification);
    this.stopVerification = undefined;
  }

  private async verifyStopped(url: string, generation: number): Promise<void> {
    if (this.disposed || generation !== this.generation) return;
    const listening = await this.probe(url);
    if (!listening) return;
    if (this.disposed || generation !== this.generation) return;
    const port = gatewayUrlPort(url);
    if (port === undefined) return;
    getLogger().info(
      { gatewayUrl: url, port },
      "Gateway still listening after its stop request; signalling the listener",
    );
    try {
      await this.stopListener(port);
    } catch (error) {
      getLogger().warn(
        { error, gatewayUrl: url, port },
        "Could not stop the gateway's port listener",
      );
    }
  }

  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.clearStopVerification();
    this.disposed = true;
    this.generation += 1;
    this.config = {};
    this.currentConfigKey = configKey(this.config);
    await this.configurationReady;
    await this.stopOwnedChild();
  }

  getOwnedProcessGroupId(): number | undefined {
    return this.ownedChild?.child.pid;
  }

  relinquishOwnedProcessGroup(processGroupId: number): boolean {
    const entry = this.ownedChild;
    if (!entry || entry.child.pid !== processGroupId) return false;
    this.ownedChild = undefined;
    return true;
  }

  /**
   * Bring the endpoint up.
   *
   * A service script that dispatches verbs needs `<command> start`; a command
   * that *is* the server needs no argument at all, and YA then owns it as a
   * foreground child exactly as it always has. Nothing standardizes the
   * difference, so YA asks the command itself: `<command> status` exiting 0 is
   * a dispatcher answering a question, while a command that ignores the
   * argument and keeps running is the server itself. An ambiguous answer
   * (nonzero exit, which is both "service stopped" and "unknown argument")
   * falls back to trying `start` and then the bare command once.
   */
  private async launchAndWait(
    url: string,
    startCommand: string,
    generation: number,
  ): Promise<string | null> {
    const style = await this.resolveCommandStyle(startCommand, generation);
    if (generation !== this.generation || this.disposed) return null;

    if (style === "bare") {
      return this.attemptLaunch(url, startCommand, generation, {
        fallbackOnNonzeroExit: false,
      });
    }

    const ready = await this.attemptLaunch(
      url,
      `${startCommand} start`,
      generation,
      { fallbackOnNonzeroExit: true },
    );
    if (ready || style === "verbs") return ready;
    if (generation !== this.generation || this.disposed) return null;
    getLogger().info(
      { gatewayUrl: url },
      "Gateway start verb did not open the endpoint; retrying the bare command",
    );
    return this.attemptLaunch(url, startCommand, generation, {
      fallbackOnNonzeroExit: false,
    });
  }

  /**
   * Ask the command whether it takes verbs, once per configuration.
   *
   * `unknown` means the probe was inconclusive and both invocation forms are
   * still worth trying; it is not an error.
   */
  private async resolveCommandStyle(
    startCommand: string,
    generation: number,
  ): Promise<GatewayCommandStyle> {
    if (this.commandStyle !== "unknown") return this.commandStyle;

    let child: ChildProcess;
    try {
      child = this.spawnCommand(`${startCommand} status`);
    } catch {
      return "unknown";
    }
    const entry = this.trackChild(child, generation);
    if (this.ownedChild === entry) this.ownedChild = undefined;
    const exited = await this.waitForClose(entry, this.statusProbeTimeoutMs);

    let style: GatewayCommandStyle;
    if (!exited) {
      // It is still running: the command ignored the argument and is the
      // server itself. Stop this probe copy and launch it the plain way.
      this.signalChild(child, "SIGTERM");
      style = "bare";
    } else if (entry.exitCode === 0) {
      style = "verbs";
    } else {
      style = "unknown";
    }
    if (generation === this.generation && !this.disposed) {
      this.commandStyle = style;
    }
    getLogger().info(
      { commandStyle: style, exitCode: entry.exitCode },
      "Probed configured gateway command for verb support",
    );
    return style;
  }

  private async attemptLaunch(
    url: string,
    startCommand: string,
    generation: number,
    options: { fallbackOnNonzeroExit: boolean },
  ): Promise<string | null> {
    await this.stopOwnedChild();
    if (generation !== this.generation || this.disposed) return null;

    let child: ChildProcess;
    try {
      child = this.spawnCommand(startCommand);
    } catch (error) {
      getLogger().warn(
        { error, gatewayUrl: url },
        "Failed to start configured Claude gateway command",
      );
      return null;
    }

    const entry = this.trackChild(child, generation);
    this.ownedChild = entry;
    getLogger().info(
      { gatewayUrl: url, pid: child.pid },
      "Started configured Claude gateway command",
    );

    const deadline = this.now() + this.readinessTimeoutMs;
    while (
      generation === this.generation &&
      !this.disposed &&
      this.now() <= deadline
    ) {
      const listening = await this.probe(url);
      if (listening) {
        getLogger().info(
          { gatewayUrl: url, listeningUrl: listening, pid: child.pid },
          "Configured Claude gateway became ready",
        );
        return listening;
      }
      if (
        entry.closed &&
        (options.fallbackOnNonzeroExit ? entry.exitCode !== 0 : true)
      ) {
        getLogger().warn(
          { gatewayUrl: url, exitCode: entry.exitCode },
          "Configured Claude gateway command exited before readiness",
        );
        return null;
      }
      await this.wait(this.readinessPollMs);
    }

    if (generation === this.generation && !this.disposed) {
      getLogger().warn(
        { gatewayUrl: url, timeoutMs: this.readinessTimeoutMs },
        "Configured Claude gateway did not become ready in time",
      );
    }
    if (this.ownedChild === entry) {
      await this.stopOwnedChild();
    }
    return null;
  }

  private trackChild(child: ChildProcess, generation: number): OwnedChild {
    let closeEntry: (() => void) | undefined;
    const entry: OwnedChild = {
      child,
      generation,
      closed: false,
      exitCode: null,
      closedPromise: new Promise((resolve) => {
        closeEntry = resolve;
      }),
    };
    const close = (code?: number | null) => {
      if (entry.closed) return;
      entry.closed = true;
      entry.exitCode = typeof code === "number" ? code : null;
      closeEntry?.();
      if (this.ownedChild === entry) {
        this.ownedChild = undefined;
      }
    };
    child.once("close", close);
    child.once("error", close);
    return entry;
  }

  private async stopOwnedChild(): Promise<void> {
    const entry = this.ownedChild;
    if (!entry) return;
    this.ownedChild = undefined;

    this.signalChild(entry.child, "SIGTERM");
    if (await this.waitForClose(entry, this.stopGraceMs)) return;

    this.signalChild(entry.child, "SIGKILL");
    await this.waitForClose(entry, this.stopGraceMs);
  }

  private waitForClose(entry: OwnedChild, timeoutMs: number): Promise<boolean> {
    if (entry.closed) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(entry.closed);
      }, timeoutMs);
      timeout.unref();
      void entry.closedPromise.then(() => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
  }
}

export const claudeGatewayLauncher = new ClaudeGatewayLauncher();
