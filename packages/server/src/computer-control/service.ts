import { createHash, randomUUID } from "node:crypto";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import {
  COMPUTER_TOOLS,
  computerOperation,
  type ComputerSession,
  type ComputerToolResult,
} from "./contract.js";
import {
  managePreview,
  installedPreview,
  readComputerImage,
  startNative,
  type ComputerPreview,
  type NativeRuntime,
} from "./native.js";
import { callComputerPipe, ComputerDeliveryError } from "./pipe.js";
import {
  compareVersions,
  discoverComputerRelease,
  stageComputerRelease,
  type ComputerRelease,
  type ReleaseProgress,
} from "./releases.js";

export interface ComputerSettings {
  enabled: boolean;
  preview?: ComputerPreview;
  idleMs: number;
  grantMs: number;
  releaseVersion?: string;
  autoUpdate?: boolean;
}
const defaults: ComputerSettings = {
  enabled: false,
  idleMs: 60_000,
  grantMs: 30 * 60_000,
};
interface Grant {
  calls: Set<string>;
  sessionId: string;
  expiresAt: number;
  generation?: string;
  references: Set<string>;
  windows: Set<number>;
}
export interface ComputerDependencies {
  platform?: string;
  start?: typeof startNative;
  call?: typeof callComputerPipe;
  image?: typeof readComputerImage;
  manage?: typeof managePreview;
  now?: () => number;
  discover?: typeof discoverComputerRelease;
  stage?: typeof stageComputerRelease;
  installed?: typeof installedPreview;
}

export class ComputerControlService {
  readonly instance: string;
  private readonly grants = new Set<Grant>();
  private runtime?: NativeRuntime;
  private busy = false;
  private stopping?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private idleAt = 0;
  private lastError?: string;
  private readonly unsubscribe: () => void;
  private latest?: ComputerRelease;
  private releaseProgress?: ReleaseProgress;
  private releaseError?: string;
  private releaseTask?: Promise<void>;
  private releaseAbort?: AbortController;
  private updateTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  constructor(
    private readonly settings: ServerSettingsService,
    private readonly dataDir: string,
    private readonly deps: ComputerDependencies = {},
  ) {
    this.instance = `ya-${createHash("sha256").update(dataDir).digest("hex").slice(0, 20)}`;
    this.unsubscribe = settings.onSettingsChanged((next, previous) => {
      const authority = (value?: ComputerSettings) =>
        JSON.stringify({
          enabled: value?.enabled,
          preview: value?.preview,
          idleMs: value?.idleMs,
          grantMs: value?.grantMs,
        });
      if (
        authority(next.computerControl) !== authority(previous.computerControl)
      ) {
        this.grants.clear();
        void this.stop().catch((error: unknown) => {
          this.lastError = String(error);
        });
      }
    });
    this.scheduleUpdates(0);
  }
  private now() {
    return this.deps.now?.() ?? Date.now();
  }
  config(): ComputerSettings {
    return { ...defaults, ...this.settings.getSetting("computerControl") };
  }
  status() {
    return {
      ...this.config(),
      available:
        (this.deps.platform ?? process.platform) === "win32" &&
        !process.versions.bun,
      instance: this.instance,
      running: !!this.runtime,
      busy: this.busy,
      lastError: this.lastError,
      release: {
        installedVersion: this.config().releaseVersion,
        latestVersion: this.latest?.version,
        updateAvailable:
          !!this.latest &&
          (!this.config().releaseVersion ||
            compareVersions(
              this.latest.version,
              this.config().releaseVersion!,
            ) > 0),
        autoUpdate: this.config().autoUpdate ?? !!this.config().releaseVersion,
        progress: this.releaseProgress,
        working: !!this.releaseTask,
        error: this.releaseError,
      },
      sessions: [...this.grants].map(({ sessionId, expiresAt }) => ({
        sessionId,
        expiresAt,
      })),
    };
  }
  async configure(value: ComputerSettings) {
    if (!value.enabled) {
      this.releaseAbort?.abort();
      await this.releaseTask;
    } else if (this.releaseTask)
      throw new Error("Computer Control installation is in progress");
    this.grants.clear();
    await this.settings.updateSettings({ computerControl: value });
    await this.stop();
    this.scheduleUpdates(0);
    return this.status();
  }
  private scheduleUpdates(delay = 24 * 60 * 60_000) {
    clearTimeout(this.updateTimer);
    if (
      this.closed ||
      !this.config().enabled ||
      !this.config().preview ||
      !this.status().release.autoUpdate ||
      !this.status().available
    )
      return;
    this.updateTimer = setTimeout(() => {
      this.requestRelease("automatic");
    }, delay);
    this.updateTimer.unref();
  }
  async setManagedEnabled(enabled: boolean) {
    this.assertPlatform();
    if (!enabled) return this.configure({ ...this.config(), enabled: false });
    if (this.config().preview)
      return this.configure({ ...this.config(), enabled: true });
    this.requestRelease("enable");
    return this.status();
  }
  async setAutoUpdate(autoUpdate: boolean) {
    if (this.releaseTask)
      throw new Error("Wait for the current download to finish");
    await this.settings.updateSettings({
      computerControl: { ...this.config(), autoUpdate },
    });
    this.scheduleUpdates(0);
    return this.status();
  }
  requestRelease(mode: "check" | "update" | "enable" | "automatic") {
    this.assertPlatform();
    if (this.closed) throw new Error("Computer Control is closing");
    if (this.releaseTask) return this.status();
    if (this.busy) {
      if (mode === "automatic") {
        this.scheduleUpdates();
        return this.status();
      }
      throw new Error("Computer Control is busy");
    }
    this.releaseAbort = new AbortController();
    this.releaseError = undefined;
    this.releaseProgress = { phase: "checking" };
    this.releaseTask = this.runRelease(mode, this.releaseAbort.signal)
      .catch((error: unknown) => {
        this.releaseError = this.releaseAbort?.signal.aborted
          ? "Download cancelled."
          : error instanceof Error
            ? error.message
            : String(error);
        this.releaseProgress = { phase: "error" };
      })
      .finally(() => {
        this.releaseTask = undefined;
        this.scheduleUpdates();
      });
    return this.status();
  }
  private async runRelease(
    mode: "check" | "update" | "enable" | "automatic",
    signal: AbortSignal,
  ) {
    const release = await (this.deps.discover ?? discoverComputerRelease)(
      signal,
    );
    signal.throwIfAborted();
    const previous = this.config();
    if (
      previous.releaseVersion &&
      compareVersions(release.version, previous.releaseVersion) < 0
    ) {
      throw new Error(
        "The release feed is older than the installed package; keeping the installed version.",
      );
    }
    this.latest = release;
    this.releaseProgress = undefined;
    if (mode === "check" || previous.releaseVersion === release.version) return;
    // Never end grants or replace a runtime to make room for an update.
    if (this.grants.size || this.busy) {
      if (mode !== "automatic")
        throw new Error(
          "Finish or revoke computer-control sessions before updating.",
        );
      return;
    }
    const staged = await (this.deps.stage ?? stageComputerRelease)(
      release,
      this.dataDir,
      signal,
      (progress) => {
        this.releaseProgress = progress;
      },
    );
    let installed: ComputerPreview | undefined;
    let activationAttempted = false;
    try {
      signal.throwIfAborted();
      if (this.grants.size || this.busy)
        throw new Error(
          "Computer Control became busy; the installed version is unchanged.",
        );
      this.busy = true;
      this.releaseProgress = { phase: "installing" };
      await this.stop();
      activationAttempted = true;
      const result = await (this.deps.manage ?? managePreview)(
        staged.preview,
        this.instance,
        "Install",
      );
      installed = (this.deps.installed ?? installedPreview)(
        staged.preview,
        this.instance,
        result.packageId,
      );
      this.runtime = await (this.deps.start ?? startNative)(
        installed,
        this.instance,
      );
      await this.stop();
      signal.throwIfAborted();
      await this.settings.updateSettings({
        computerControl: {
          ...previous,
          preview: installed,
          releaseVersion: release.version,
          enabled: mode === "enable" || previous.enabled,
          autoUpdate: previous.autoUpdate !== false,
        },
      });
      this.releaseProgress = { phase: "ready" };
    } catch (error) {
      if (installed || (activationAttempted && previous.preview)) {
        try {
          await this.stop();
          if (previous.preview)
            await (this.deps.manage ?? managePreview)(
              previous.preview,
              this.instance,
              "Install",
            );
          else
            await (this.deps.manage ?? managePreview)(
              installed!,
              this.instance,
              "Uninstall",
            );
        } catch (rollbackError) {
          await this.settings.updateSettings({
            computerControl: {
              ...previous,
              enabled: false,
              preview: previous.preview ?? installed,
            },
          });
          throw new Error(
            `Update failed and recovery needs attention: ${String(rollbackError)}`,
          );
        }
      }
      throw error;
    } finally {
      this.busy = false;
      await staged.cleanup();
    }
  }
  async install(preview: ComputerPreview) {
    this.assertPlatform();
    if (this.releaseTask)
      throw new Error("Computer Control download is in progress");
    if (this.busy) throw new Error("Computer control is busy");
    this.busy = true;
    try {
      this.grants.clear();
      await this.settings.updateSettings({
        computerControl: { ...this.config(), enabled: false },
      });
      await this.stop();
      const result = await (this.deps.manage ?? managePreview)(
        preview,
        this.instance,
        "Install",
      );
      await this.settings.updateSettings({
        computerControl: {
          ...this.config(),
          enabled: false,
          releaseVersion: undefined,
          autoUpdate: false,
          preview: installedPreview(preview, this.instance, result.packageId),
        },
      });
      return result;
    } finally {
      this.busy = false;
    }
  }
  async uninstall() {
    this.assertPlatform();
    this.releaseAbort?.abort();
    await this.releaseTask;
    clearTimeout(this.updateTimer);
    if (this.busy) throw new Error("Computer control is busy");
    this.busy = true;
    try {
      const preview = this.config().preview;
      this.grants.clear();
      await this.settings.updateSettings({
        computerControl: { ...this.config(), enabled: false },
      });
      await this.stop();
      if (preview)
        await (this.deps.manage ?? managePreview)(
          preview,
          this.instance,
          "Uninstall",
        );
      await this.settings.updateSettings({ computerControl: { ...defaults } });
    } finally {
      this.busy = false;
    }
  }
  private assertPlatform() {
    if (
      (this.deps.platform ?? process.platform) !== "win32" ||
      process.versions.bun
    )
      throw new Error(
        "Computer control requires Windows with the Node runtime",
      );
  }
  select(
    sessionId: string,
    selected: boolean | undefined,
    provider: string,
    executor?: string,
    sandbox?: string,
  ): ComputerSession | undefined {
    if (selected !== undefined && typeof selected !== "boolean")
      throw new Error("computerControl must be a boolean");
    if (!selected) return undefined;
    this.assertPlatform();
    if (this.releaseTask)
      throw new Error(
        "Computer Control is checking or installing a release; try again shortly",
      );
    if (provider !== "codex" || executor || (sandbox && sandbox !== "none"))
      throw new Error(
        "Computer control requires a local unsandboxed Codex session",
      );
    const config = this.config();
    if (!config.enabled || !config.preview)
      throw new Error(
        "Computer control is disabled or no authenticated preview is installed",
      );
    if (this.grants.size >= 32)
      throw new Error("Computer control session limit reached");
    const grant: Grant = {
      calls: new Set(),
      sessionId,
      expiresAt: this.now() + config.grantMs,
      references: new Set(),
      windows: new Set(),
    };
    this.grants.add(grant);
    this.schedule();
    return {
      tools: COMPUTER_TOOLS,
      call: (tool, args, callId) => this.execute(grant, tool, args, callId),
      acceptsThread: (threadId) => threadId === grant.sessionId,
      close: () => this.revokeGrant(grant),
      rename: (id) => {
        grant.sessionId = id;
      },
    };
  }
  async revoke(sessionId: string) {
    for (const grant of this.grants)
      if (grant.sessionId === sessionId) this.grants.delete(grant);
    if (!this.grants.size && !this.busy) await this.stop();
    this.schedule();
    this.updateWhenIdle();
  }
  private async revokeGrant(grant: Grant) {
    this.grants.delete(grant);
    if (!this.grants.size && !this.busy) await this.stopAfterCall();
    this.schedule();
    this.updateWhenIdle();
  }
  private updateWhenIdle() {
    if (
      !this.grants.size &&
      !this.busy &&
      !this.releaseTask &&
      this.latest &&
      this.status().release.updateAvailable
    )
      this.scheduleUpdates(0);
  }
  private authorized(grant: Grant) {
    return (
      this.grants.has(grant) &&
      grant.expiresAt > this.now() &&
      this.config().enabled
    );
  }
  private async execute(
    grant: Grant,
    tool: string,
    args: unknown,
    callId?: string,
  ): Promise<ComputerToolResult> {
    let acquired = false;
    let nativeResult: Record<string, unknown> | undefined;
    try {
      if (!this.authorized(grant))
        throw new Error("Computer control grant expired or revoked");
      if (callId) {
        if (grant.calls.has(callId) || grant.calls.size >= 2048)
          throw new Error(
            "Duplicate computer call or session operation limit exceeded; no replay",
          );
        grant.calls.add(callId);
      }
      if (tool !== "computer_control") throw new Error("Unknown computer tool");
      const request = computerOperation.parse(args);
      if (
        "expectedGeneration" in request &&
        request.expectedGeneration !== grant.generation
      )
        throw new Error("A fresh observation from this session is required");
      if ("reference" in request && !grant.references.has(request.reference))
        throw new Error("Unknown or expired session reference");
      if (
        "hwnd" in request &&
        request.hwnd &&
        request.operation !== "snapshot" &&
        request.operation !== "screenshot" &&
        !grant.windows.has(request.hwnd)
      )
        throw new Error("Unknown session window");
      if (this.busy)
        throw new Error(
          "Computer desktop is busy; no operation was dispatched",
        );
      this.busy = acquired = true;
      await this.stopping;
      if (!this.runtime)
        this.runtime = await (this.deps.start ?? startNative)(
          this.config().preview!,
          this.instance,
        );
      const runtime = this.runtime;
      if (!this.authorized(grant))
        throw new Error("Computer control grant revoked during startup");
      if (
        "expectedGeneration" in request &&
        request.expectedGeneration !== this.runtime.generation
      )
        throw new Error(
          "Resident generation changed; take a fresh observation",
        );
      this.runtime.activity();
      nativeResult = await (this.deps.call ?? callComputerPipe)(
        this.runtime.owner.pipe,
        { ...request, requestId: randomUUID() },
      );
      this.runtime?.activity();
      if (
        nativeResult.sessionId !== runtime.owner.sessionId ||
        nativeResult.generation !== runtime.generation
      )
        throw new ComputerDeliveryError(
          "Native session/generation response mismatch",
          "unknown",
        );
      if (!this.authorized(grant))
        return {
          success: false,
          contentItems: [
            {
              type: "inputText",
              text: JSON.stringify({
                ...nativeResult,
                data: undefined,
                message:
                  "Grant revoked while the native operation was in flight; observe effects independently",
              }),
            },
          ],
        };
      if (
        nativeResult.accepted &&
        ["windows", "snapshot", "screenshot"].includes(request.operation)
      ) {
        grant.generation = this.runtime.generation;
        if (request.operation === "snapshot") grant.references.clear();
        const collect = (value: unknown, depth = 0) => {
          if (depth > 20 || !value || typeof value !== "object") return;
          const record = value as Record<string, unknown>;
          for (const key of ["reference", "r"])
            if (
              request.operation === "snapshot" &&
              typeof record[key] === "string" &&
              grant.references.size < 1000
            )
              grant.references.add(record[key]);
          if (typeof record.hwnd === "number" && grant.windows.size < 1000)
            grant.windows.add(record.hwnd);
          for (const child of Object.values(record)) collect(child, depth + 1);
        };
        collect(nativeResult.data);
      }
      const contentItems: ComputerToolResult["contentItems"] = [
        { type: "inputText", text: JSON.stringify(nativeResult) },
      ];
      if (request.operation === "screenshot" && nativeResult.accepted)
        contentItems.push({
          type: "inputImage",
          imageUrl: await (this.deps.image ?? readComputerImage)(
            this.runtime.owner.artifactRoot,
            nativeResult.data as Record<string, unknown>,
          ),
        });
      if (!this.authorized(grant))
        throw new Error("Computer control grant revoked during artifact read");
      return { success: nativeResult.accepted === true, contentItems };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      if (error instanceof ComputerDeliveryError && acquired)
        await this.stopAfterCall();
      const delivery =
        error instanceof ComputerDeliveryError
          ? error.delivery
          : nativeResult
            ? nativeResult.delivery
            : "refused";
      return {
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: JSON.stringify({
              ...(nativeResult ?? {}),
              ...(!this.authorized(grant) ? { data: undefined } : {}),
              accepted: false,
              delivery,
              effect:
                nativeResult?.effect ??
                (delivery === "unknown" ? "unknown" : "refused"),
              uncertainty:
                nativeResult?.uncertainty ??
                (delivery === "unknown"
                  ? "Operation may have executed; never replay automatically"
                  : "none"),
              errorCode: "computer_control_refused",
              message: error instanceof Error ? error.message : String(error),
            }),
          },
        ],
      };
    } finally {
      if (acquired) {
        this.busy = false;
        this.idleAt = this.now() + this.config().idleMs;
        if (!this.grants.size || !this.config().enabled)
          await this.stopAfterCall();
        this.schedule();
        this.updateWhenIdle();
      }
    }
  }
  private async stopAfterCall() {
    try {
      await this.stop();
    } catch (error) {
      this.lastError = `Owned runtime cleanup failed: ${String(error)}`;
    }
  }
  private schedule() {
    clearTimeout(this.timer);
    for (const grant of this.grants)
      if (grant.expiresAt <= this.now()) this.grants.delete(grant);
    const deadline = Math.min(
      ...[...this.grants].map((grant) => grant.expiresAt),
      ...(this.runtime ? [this.idleAt || this.now()] : []),
    );
    if (!Number.isFinite(deadline)) return;
    this.timer = setTimeout(
      () => {
        for (const grant of this.grants)
          if (grant.expiresAt <= this.now()) this.grants.delete(grant);
        if (!this.busy && (this.idleAt <= this.now() || !this.grants.size))
          void this.stop()
            .then(() => {
              this.schedule();
              this.updateWhenIdle();
            })
            .catch((error: unknown) => {
              this.lastError = String(error);
            });
        else if (!this.busy) this.schedule();
      },
      Math.max(1, deadline - this.now()),
    );
    this.timer.unref();
  }
  async stop() {
    if (this.stopping) return this.stopping;
    if (!this.runtime) return;
    const runtime = this.runtime;
    this.runtime = undefined;
    for (const grant of this.grants) {
      grant.generation = undefined;
      grant.references.clear();
      grant.windows.clear();
    }
    this.stopping = runtime
      .stop()
      .catch((error: unknown) => {
        this.runtime = runtime;
        this.lastError = String(error);
        throw error;
      })
      .finally(() => {
        this.stopping = undefined;
      });
    return this.stopping;
  }
  async close() {
    this.closed = true;
    clearTimeout(this.updateTimer);
    this.releaseAbort?.abort();
    await this.releaseTask;
    this.unsubscribe();
    clearTimeout(this.timer);
    this.grants.clear();
    await this.stopAfterCall();
  }
}
