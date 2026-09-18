import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { getLogger } from "../../logging/logger.js";
import type {
  PrewarmableSpeechBackend,
  TranscribeOptions,
} from "./SpeechBackend.js";
import {
  cacheFreeSpaceSummary,
  defaultHuggingFaceHubCache,
  ensureLocalSttRuntime,
  localSttEnv,
  PIXI_COMMAND,
  PIXI_STT_ENV,
  summarizeChildError,
} from "./localSttRuntime.js";
import { SerialQueue } from "./serialQueue.js";

const logger = getLogger();

export interface WarmPixiSttBackendConfig {
  /** Backend id advertised to clients (e.g. "ya-parakeet"). */
  id: string;
  /** Human-readable label for settings UI and diagnostics. */
  label: string;
  /** Short tag used in log lines and worker error messages (e.g. "parakeet"). */
  logTag: string;
  /** Model-family name used in operator-facing sentences ("Parakeet worker exited"). */
  displayName: string;
  /** Absolute path of the Python worker script. */
  workerScript: string;
  /** Pixi environment the worker runs in. */
  environment?: string;
  /** Model loaded when neither the operator nor the request names one. */
  defaultModel: string;
  /** Milliseconds to wait for model load before giving up. */
  modelLoadTimeoutMs: number;
  /** Appended to load/transcribe failures with concrete recovery steps. */
  repairHint: string;
  /** Startup import probe plus the pixi task that installs what it needs. */
  runtime: {
    backendLabel: string;
    checkPython: string;
    bootstrapTask: string;
  };
}

/**
 * A local speech backend that keeps one Python model process warm inside a
 * pixi environment.
 *
 * All of YA's Hugging-Face-style local recognizers share this lifecycle: probe
 * the pixi environment at startup, defer the model load to prewarm/first
 * transcribe, keep a single worker alive, and serialize loads and utterances
 * onto one queue so a request that arrives mid-load waits instead of failing as
 * busy. Only the pixi environment, worker script, model defaults, and repair
 * advice differ per model family, so those are the config above rather than a
 * copy of this file.
 *
 * The worker protocol is one JSON object per line in each direction:
 * `{"status":"ready"}` once the model loads, then `{"text":...}` or
 * `{"error":...}` per request.
 */
export class WarmPixiSttBackend implements PrewarmableSpeechBackend {
  readonly id: string;
  readonly label: string;

  protected readonly config: WarmPixiSttBackendConfig;
  protected readonly environment: string;
  protected readonly model: string;
  protected readonly device: string;

  private proc: ChildProcess | null = null;
  private warmPromise: Promise<void> | null = null;
  private workerReady = false;
  private workerModel: string | null = null;
  private workerDevice: string | null = null;
  private pendingResolve: ((text: string) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private readonly queue = new SerialQueue();

  constructor(
    config: WarmPixiSttBackendConfig,
    opts: { model?: string; device?: string } = {},
  ) {
    this.config = config;
    this.id = config.id;
    this.label = config.label;
    this.environment = config.environment ?? PIXI_STT_ENV;
    this.model = opts.model ?? config.defaultModel;
    this.device = opts.device ?? "auto";
  }

  async validate(): Promise<{ ok: true } | { ok: false; reason: string }> {
    // Availability check only — confirm the pixi env and the Python imports
    // (auto-bootstrapping them if missing). The model load is deferred to
    // prewarm() / first transcribe() so a slow load never blocks registration:
    // the backend is advertised immediately and stays selectable while its
    // model is still loading; only sending audio to it waits on the load.
    return ensureLocalSttRuntime({
      ...this.config.runtime,
      environment: this.environment,
    });
  }

  private stopWorker(): void {
    const proc = this.proc;
    this.proc = null;
    this.warmPromise = null;
    this.workerReady = false;
    this.workerModel = null;
    this.workerDevice = null;
    proc?.kill();
  }

  private startWorker(model: string, device: string): Promise<void> {
    if (this.warmPromise) {
      if (this.workerModel === model && this.workerDevice === device) {
        return this.warmPromise;
      }
      if (!this.workerReady || this.pendingResolve) {
        throw new Error(
          `${this.config.displayName} backend is busy with another request`,
        );
      }
      this.stopWorker();
    }

    this.warmPromise = new Promise<void>((resolve, reject) => {
      logger.info(
        `Starting ${this.config.logTag} worker via pixi env "${this.environment}" (model=${model} device=${device})`,
      );
      this.workerReady = false;
      this.workerModel = model;
      this.workerDevice = device;

      const proc = spawn(
        PIXI_COMMAND,
        [
          "run",
          "--frozen",
          "-e",
          this.environment,
          "python",
          this.config.workerScript,
          model,
          device,
        ],
        {
          cwd: process.cwd(),
          env: localSttEnv(),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      this.proc = proc;

      let ready = false;
      let loadTimeout: NodeJS.Timeout | null = null;

      proc.stderr?.on("data", (chunk: Buffer) => {
        logger.debug(`[${this.config.logTag}] ${chunk.toString().trim()}`);
      });

      proc.on("error", (error) => {
        if (this.proc !== proc) return;
        if (!ready) {
          if (loadTimeout) clearTimeout(loadTimeout);
          reject(error);
        }
      });

      proc.on("exit", (code) => {
        logger.warn(`${this.config.displayName} worker exited (code=${code})`);
        const currentWorkerExited = this.proc === proc;
        if (currentWorkerExited) {
          this.proc = null;
          this.warmPromise = null;
          this.workerReady = false;
          this.workerModel = null;
          this.workerDevice = null;
        }
        if (currentWorkerExited && this.pendingReject) {
          this.pendingReject(
            new Error(`${this.config.displayName} worker exited unexpectedly`),
          );
          this.pendingResolve = null;
          this.pendingReject = null;
        }
      });

      const rl = createInterface({ input: proc.stdout! });

      loadTimeout = setTimeout(() => {
        if (!ready) {
          reject(new Error(`${this.config.displayName} model load timed out`));
          proc.kill();
        }
      }, this.config.modelLoadTimeoutMs);

      rl.on("line", (line: string) => {
        if (this.proc !== proc) return;
        try {
          const msg = JSON.parse(line) as {
            status?: string;
            text?: string;
            error?: string;
          };

          if (!ready) {
            clearTimeout(loadTimeout);
            if (msg.status === "ready") {
              ready = true;
              this.workerReady = true;
              resolve();
            } else {
              reject(new Error(msg.error ?? "Worker failed to start"));
            }
            return;
          }

          if (this.pendingResolve && this.pendingReject) {
            if (msg.error) {
              this.pendingReject(new Error(msg.error));
            } else {
              this.pendingResolve(msg.text ?? "");
            }
            this.pendingResolve = null;
            this.pendingReject = null;
          }
        } catch {
          logger.debug(`[${this.config.logTag}] stdout: ${line}`);
        }
      });
    });

    return this.warmPromise;
  }

  async prewarm(options: TranscribeOptions = {}): Promise<void> {
    const model = options.model?.trim() || this.model;
    const cacheDir = defaultHuggingFaceHubCache();
    logger.info(
      `[Voice] ${this.id} preload: loading model "${model}" on device=${this.device} (cache=${cacheDir}; ${cacheFreeSpaceSummary(cacheDir)})`,
    );
    try {
      await this.queue.run(() => this.startWorker(model, this.device));
    } catch (error) {
      throw new Error(
        `${summarizeChildError(error)} ${this.config.repairHint}`,
      );
    }
  }

  async transcribe(
    audio: Buffer,
    options: TranscribeOptions = {},
  ): Promise<string> {
    const model = options.model?.trim() || this.model;
    // Queue behind any in-flight load/transcribe: record audio, block on the
    // load, then transcribe — instead of rejecting as "busy".
    return this.queue.run(async () => {
      try {
        await this.startWorker(model, this.device);
      } catch (error) {
        throw new Error(
          `${summarizeChildError(error)} ${this.config.repairHint}`,
        );
      }

      if (!this.proc?.stdin) {
        throw new Error(`${this.config.displayName} worker is not running`);
      }

      return new Promise<string>((resolve, reject) => {
        this.pendingResolve = resolve;
        this.pendingReject = reject;

        const req = {
          audio_b64: audio.toString("base64"),
          mime_type: options.mimeType ?? "audio/webm;codecs=opus",
          ...(options.keyterms && options.keyterms.length > 0
            ? { keyterms: options.keyterms }
            : {}),
        };

        this.proc!.stdin!.write(`${JSON.stringify(req)}\n`);
      });
    });
  }
}

/** Resolve a worker script that ships next to the compiled backend modules. */
export function workerScriptPath(moduleUrl: string, script: string): string {
  return fileURLToPath(new URL(script, moduleUrl));
}
