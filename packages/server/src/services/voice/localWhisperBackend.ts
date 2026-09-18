import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getLogger } from "../../logging/logger.js";
import type {
  PrewarmableSpeechBackend,
  TranscribeOptions,
} from "./SpeechBackend.js";
import {
  ensureLocalSttRuntime,
  localSttEnv,
  PIXI_COMMAND,
  PIXI_STT_ENV,
} from "./localSttRuntime.js";
import { SerialQueue } from "./serialQueue.js";
const logger = getLogger();

const WORKER_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "whisper_worker.py",
);

/** Milliseconds to wait for model load before giving up. */
const MODEL_LOAD_TIMEOUT_MS = 120_000;
const GPU_ENVIRONMENT = "stt-whisper-gpu";

export class LocalWhisperBackend implements PrewarmableSpeechBackend {
  readonly id = "ya-whisper";
  readonly label = "Local Whisper (pixi stt)";

  private readonly model: string;
  private device: string;
  private readonly computeType: string;

  private proc: ChildProcess | null = null;
  private warmPromise: Promise<void> | null = null;
  private workerModel: string | null = null;
  private workerDevice: string | null = null;
  private pendingResolve: ((text: string) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  // Serializes transcriptions onto one queue (single worker), so a request
  // during a load or another transcription waits instead of failing as "busy".
  private readonly queue = new SerialQueue();

  constructor(
    opts: { model?: string; device?: string; computeType?: string } = {},
  ) {
    this.model = opts.model ?? "distil-large-v3.5";
    this.device = opts.device ?? "cpu";
    this.computeType = opts.computeType ?? "int8";
  }

  async validate(): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (this.device !== "cpu") return this.ensureGpuRuntime();
    return ensureLocalSttRuntime({
      backendLabel: "local STT",
      checkPython:
        "from faster_whisper import WhisperModel; from faster_whisper.utils import available_models; assert 'distil-large-v3.5' in available_models(), 'faster-whisper 1.2.1 or newer is required'",
      bootstrapTask: "stt-bootstrap",
    });
  }

  getDevice(): string {
    return this.device;
  }

  private ensureGpuRuntime() {
    return ensureLocalSttRuntime({
      backendLabel: "Whisper GPU",
      environment: GPU_ENVIRONMENT,
      checkPython:
        "from faster_whisper import WhisperModel; import nvidia.cublas.lib, nvidia.cudnn.lib",
      bootstrapTask: "whisper-gpu-bootstrap",
    });
  }

  /** Serialize device changes behind any active dictation; preserve its model. */
  async setGpuEnabled(enabled: boolean): Promise<void> {
    return this.queue.run(async () => {
      if (enabled && this.device === "cpu") {
        const runtime = await this.ensureGpuRuntime();
        if (!runtime.ok) throw new Error(runtime.reason);
      }
      this.device = enabled ? "cuda" : "cpu";
      if (this.proc) await this.startWorker(this.workerModel ?? this.model);
    });
  }

  private async startWorker(model: string): Promise<void> {
    if (
      this.proc &&
      (this.workerModel !== model || this.workerDevice !== this.device)
    ) {
      const previous = this.proc;
      // This runs inside the queue, after the preceding transcription settles.
      // Reclaim the old model before allocating another one.
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Whisper worker did not stop")),
          5000,
        );
        previous.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        previous.kill();
      });
    }
    if (this.warmPromise) return this.warmPromise;

    this.warmPromise = new Promise<void>((resolve, reject) => {
      const environment =
        this.device === "cpu" ? PIXI_STT_ENV : GPU_ENVIRONMENT;
      logger.info(
        `Starting whisper worker via pixi env "${environment}" (model=${model} device=${this.device} compute_type=${this.computeType})`,
      );

      const proc = spawn(
        PIXI_COMMAND,
        [
          "run",
          "--frozen",
          "-e",
          environment,
          WORKER_SCRIPT,
          model,
          this.device,
          this.computeType,
        ],
        {
          cwd: process.cwd(),
          env: localSttEnv(),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      this.proc = proc;
      this.workerModel = model;
      this.workerDevice = this.device;

      let ready = false;
      let loadTimeout: NodeJS.Timeout | null = null;

      proc.stderr?.on("data", (chunk: Buffer) => {
        logger.debug(`[whisper] ${chunk.toString().trim()}`);
      });

      proc.on("error", (error) => {
        if (this.proc !== proc) return;
        if (!ready) {
          if (loadTimeout) clearTimeout(loadTimeout);
          this.proc = null;
          this.warmPromise = null;
          this.workerModel = null;
          reject(error);
        }
      });

      proc.on("exit", (code) => {
        if (loadTimeout) clearTimeout(loadTimeout);
        if (!ready)
          reject(
            new Error(`Whisper worker exited before loading (code=${code})`),
          );
        if (this.proc !== proc) return;
        logger.debug(`Whisper worker exited (code=${code})`);
        this.proc = null;
        this.warmPromise = null;
        this.workerModel = null;
        if (this.pendingReject) {
          this.pendingReject(new Error("Whisper worker exited unexpectedly"));
          this.pendingResolve = null;
          this.pendingReject = null;
        }
      });

      const rl = createInterface({ input: proc.stdout! });

      loadTimeout = setTimeout(() => {
        if (!ready) {
          reject(new Error("Whisper model load timed out"));
          proc.kill();
        }
      }, MODEL_LOAD_TIMEOUT_MS);

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
              resolve();
            } else {
              reject(new Error(msg.error ?? "Worker failed to start"));
              proc.kill();
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
          logger.warn(`Unparseable whisper output: ${line}`);
        }
      });
    });

    try {
      await this.warmPromise;
    } catch (error) {
      this.warmPromise = null;
      this.workerModel = null;
      throw error;
    }
  }

  async prewarm(options: TranscribeOptions = {}): Promise<void> {
    return this.queue.run(() =>
      this.startWorker(options.model?.trim() || this.model),
    );
  }

  async transcribe(
    audio: Buffer,
    options: TranscribeOptions = {},
  ): Promise<string> {
    // Queue behind any in-flight load/transcribe: record audio, block on the
    // load, then transcribe — instead of rejecting as "busy".
    return this.queue.run(async () => {
      await this.startWorker(options.model?.trim() || this.model);

      if (!this.proc?.stdin) {
        throw new Error("Whisper worker is not running");
      }

      return new Promise<string>((resolve, reject) => {
        this.pendingResolve = resolve;
        this.pendingReject = reject;

        const req = {
          audio_b64: audio.toString("base64"),
          mime_type: options.mimeType ?? "audio/webm;codecs=opus",
          prompt: options.prompt ?? "",
        };

        this.proc!.stdin!.write(`${JSON.stringify(req)}\n`);
      });
    });
  }
}
