import {
  type ChildProcess,
  type SpawnOptions,
  spawn as nodeSpawn,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ProviderLoginFlow, ProviderName } from "@yep-anywhere/shared";
import { getLogger } from "../logging/logger.js";
import type { ProviderLoginLaunch } from "../sdk/providers/types.js";
import { formatExecutableInvocation } from "../utils/executableInvocation.js";
import {
  processTreeSpawnOptions,
  signalProcessTree,
} from "../utils/processTree.js";

/** Codex device codes expire after 15 minutes; Claude's page code sooner. */
const LOGIN_FLOW_TIMEOUT_MS = 15 * 60_000;
/** A finished flow stays readable long enough for the client to see it end. */
const FINISHED_FLOW_RETENTION_MS = 5 * 60_000;
const OUTPUT_TAIL_CHARS = 4000;
const MAX_CODE_LENGTH = 512;

const log = getLogger().child({ component: "provider-login" });

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

interface FlowRecord {
  flow: ProviderLoginFlow;
  child: ChildProcess | null;
  rawOutput: string;
  timeout: NodeJS.Timeout | null;
  retention: NodeJS.Timeout | null;
}

export class ProviderLoginError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 422,
  ) {
    super(message);
  }
}

// OSC (hyperlinks, titles), CSI (colors, cursor), then remaining C0 controls.
// biome-ignore lint/suspicious/noControlCharactersInRegex: OSC sequences contain literal ESC and BEL control characters.
const OSC_SEQUENCE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: CSI sequences start with the ESC control character.
const CSI_SEQUENCE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: remove C0 controls while preserving tab and newline.
const CONTROL_CHARACTERS = /[\x00-\x08\x0b-\x1f\x7f]/g;

export function stripTerminalControls(text: string): string {
  return text
    .replace(OSC_SEQUENCE, "")
    .replace(CSI_SEQUENCE, "")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARACTERS, "");
}

const SIGN_IN_URL = /https:\/\/[^\s<>"'`\]]+/;
// Codex device codes look like `IXHO-DHC63`; URLs and ids are lowercase.
const DEVICE_CODE = /\b[A-Z0-9]{4,5}-[A-Z0-9]{4,6}\b/;

/** Extract the sign-in link and any one-time code from sanitized output. */
export function parseLoginOutput(text: string): {
  url?: string;
  userCode?: string;
} {
  const url = text.match(SIGN_IN_URL)?.[0];
  const afterUrl = url ? text.slice(text.indexOf(url) + url.length) : "";
  const userCode = afterUrl.match(DEVICE_CODE)?.[0];
  return {
    ...(url ? { url } : {}),
    ...(userCode ? { userCode } : {}),
  };
}

function isWindowsCommandScript(path: string, platform: NodeJS.Platform) {
  return platform === "win32" && /\.(?:cmd|bat)$/i.test(path);
}

/**
 * Runs provider sign-in CLIs for the server owner, one flow per provider.
 *
 * A relayed flow runs without a terminal: the client shows the link (and
 * device code) the CLI prints, and an authorization code typed into YA is
 * written to the CLI's stdin. Every flow is killed at its deadline.
 */
export class ProviderLoginService {
  private readonly flows = new Map<ProviderName, FlowRecord>();
  private readonly spawn: SpawnFn;
  private readonly platform: NodeJS.Platform;

  constructor(options: { spawn?: SpawnFn; platform?: NodeJS.Platform } = {}) {
    this.spawn = options.spawn ?? nodeSpawn;
    this.platform = options.platform ?? process.platform;
  }

  /** Whether a visible terminal can be opened on this host's desktop. */
  supportsHostTerminal(): boolean {
    return this.platform === "win32" || this.platform === "darwin";
  }

  get(provider: ProviderName): ProviderLoginFlow | null {
    return this.flows.get(provider)?.flow ?? null;
  }

  /** Start a relayed sign-in, replacing any flow already running. */
  start(
    provider: ProviderName,
    launch: ProviderLoginLaunch,
  ): ProviderLoginFlow {
    this.cancel(provider);
    const startedAt = Date.now();
    const record: FlowRecord = {
      flow: {
        id: randomUUID(),
        provider,
        state: "running",
        acceptsCode: launch.acceptsCode,
        codeSubmitted: false,
        output: "",
        startedAt: new Date(startedAt).toISOString(),
        expiresAt: new Date(startedAt + LOGIN_FLOW_TIMEOUT_MS).toISOString(),
      },
      child: null,
      rawOutput: "",
      timeout: null,
      retention: null,
    };
    this.flows.set(provider, record);

    const { command, args, verbatim } = this.commandLine(
      launch.executable,
      launch.relayedArgs,
    );
    let child: ChildProcess;
    try {
      child = this.spawn(command, args, {
        ...processTreeSpawnOptions,
        env: launch.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: verbatim,
      });
    } catch (error) {
      this.finish(record, "failed", String(error));
      return record.flow;
    }
    record.child = child;

    const append = (chunk: Buffer | string) => {
      record.rawOutput = (record.rawOutput + chunk.toString()).slice(
        -OUTPUT_TAIL_CHARS * 4,
      );
      const text = stripTerminalControls(record.rawOutput);
      record.flow = {
        ...record.flow,
        ...parseLoginOutput(text),
        output: text.slice(-OUTPUT_TAIL_CHARS),
      };
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.stdin?.on("error", () => {});
    child.on("error", (error) => {
      log.warn({ provider, error }, "Provider sign-in failed to start");
      this.finish(record, "failed", error.message);
    });
    child.on("close", (code) => {
      if (record.flow.state !== "running") return;
      this.finish(record, code === 0 ? "succeeded" : "failed");
    });
    record.timeout = setTimeout(
      () => this.finish(record, "expired"),
      LOGIN_FLOW_TIMEOUT_MS,
    );
    record.timeout.unref?.();
    return record.flow;
  }

  /** Send the authorization code the provider's page displayed. */
  submitCode(
    provider: ProviderName,
    flowId: string,
    code: string,
  ): ProviderLoginFlow {
    const record = this.requireRunning(provider, flowId);
    const trimmed = code.trim();
    if (!record.flow.acceptsCode) {
      throw new ProviderLoginError("This sign-in does not take a code", 409);
    }
    if (!trimmed || trimmed.length > MAX_CODE_LENGTH || /\s/.test(trimmed)) {
      throw new ProviderLoginError("Invalid authorization code", 422);
    }
    record.child?.stdin?.write(`${trimmed}\n`);
    record.flow = { ...record.flow, codeSubmitted: true };
    return record.flow;
  }

  cancel(provider: ProviderName, flowId?: string): ProviderLoginFlow | null {
    const record = this.flows.get(provider);
    if (!record || (flowId && record.flow.id !== flowId)) return null;
    if (record.flow.state === "running") this.finish(record, "cancelled");
    return record.flow;
  }

  /** Open the sign-in in a new terminal window on this host's desktop. */
  openHostTerminal(launch: ProviderLoginLaunch): void {
    if (this.platform === "win32") {
      if (/["%]/.test(launch.executable)) {
        throw new ProviderLoginError(
          "The provider path cannot be passed to a terminal",
          422,
        );
      }
      // `start` always creates a console window; `cmd /k` keeps it open so
      // the outcome stays readable after the CLI exits.
      const line = [
        "/d",
        "/c",
        "start",
        '"Yep Anywhere sign-in"',
        "cmd.exe",
        "/k",
        `"${launch.executable}"`,
        ...launch.terminalArgs,
      ].join(" ");
      this.spawnTerminalLauncher("cmd.exe", [line], launch.env, true);
      return;
    }
    if (this.platform === "darwin") {
      const command = formatExecutableInvocation(
        launch.executable,
        launch.terminalArgs.join(" "),
        "darwin",
      );
      const script = command.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      this.spawnTerminalLauncher(
        "osascript",
        [
          "-e",
          `tell application "Terminal" to do script "${script}"`,
          "-e",
          'tell application "Terminal" to activate',
        ],
        launch.env,
        false,
      );
      return;
    }
    throw new ProviderLoginError(
      "Opening a terminal is not supported on this host",
      409,
    );
  }

  dispose(): void {
    for (const provider of [...this.flows.keys()]) {
      this.cancel(provider);
      const record = this.flows.get(provider);
      if (record?.retention) clearTimeout(record.retention);
    }
    this.flows.clear();
  }

  private spawnTerminalLauncher(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    verbatim: boolean,
  ): void {
    const child = this.spawn(command, args, {
      // On Windows the launcher is a hidden cmd.exe that exits once `start`
      // has opened the new console; detaching it would leave it no console.
      detached: this.platform !== "win32",
      env,
      stdio: "ignore",
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
    });
    child.on("error", (error) => {
      log.warn({ command, error }, "Failed to open sign-in terminal");
    });
    child.unref();
  }

  private commandLine(
    executable: string,
    args: readonly string[],
  ): { command: string; args: string[]; verbatim: boolean } {
    if (!isWindowsCommandScript(executable, this.platform)) {
      return { command: executable, args: [...args], verbatim: false };
    }
    // npm installs `.cmd` shims, which only cmd.exe can execute.
    return {
      command: "cmd.exe",
      args: [`/d /s /c ""${executable}" ${args.join(" ")}"`],
      verbatim: true,
    };
  }

  private requireRunning(provider: ProviderName, flowId: string): FlowRecord {
    const record = this.flows.get(provider);
    if (!record || record.flow.id !== flowId) {
      throw new ProviderLoginError("No such sign-in", 404);
    }
    if (record.flow.state !== "running") {
      throw new ProviderLoginError("This sign-in has ended", 409);
    }
    return record;
  }

  private finish(
    record: FlowRecord,
    state: Exclude<ProviderLoginFlow["state"], "running">,
    detail?: string,
  ): void {
    if (record.flow.state !== "running") return;
    if (record.timeout) clearTimeout(record.timeout);
    record.timeout = null;
    const child = record.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      signalProcessTree(child, "SIGTERM");
    }
    const output = detail
      ? `${record.flow.output}\n${detail}`.trim().slice(-OUTPUT_TAIL_CHARS)
      : record.flow.output;
    record.flow = { ...record.flow, state, output };
    record.retention = setTimeout(() => {
      if (this.flows.get(record.flow.provider) === record) {
        this.flows.delete(record.flow.provider);
      }
    }, FINISHED_FLOW_RETENTION_MS);
    record.retention.unref?.();
  }
}
