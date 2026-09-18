import {
  localSpeechBackendSpec,
  type LocalSpeechBackendId,
  type SpeechBackendInstallStatus,
} from "@yep-anywhere/shared";
import { getLogger } from "../../logging/logger.js";
import {
  LOCAL_STT_BOOTSTRAP_TIMEOUT_MS,
  runPixiLogged,
} from "./localSttRuntime.js";

const logger = getLogger();
const MAX_LOG_LINES = 2000;

export class SpeechBackendInstallService {
  private current: SpeechBackendInstallStatus = { running: false, lines: [] };
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly onInstalled?: (id: LocalSpeechBackendId) => Promise<void>,
  ) {}

  status(): SpeechBackendInstallStatus {
    return { ...this.current, lines: [...this.current.lines] };
  }

  start(backendId: string): { ok: true } | { ok: false; reason: string } {
    const spec = localSpeechBackendSpec(backendId);
    if (!spec) {
      return {
        ok: false,
        reason: `Unknown local speech backend: ${backendId}`,
      };
    }
    if (this.current.running) {
      return {
        ok: false,
        reason: `Install already running for ${this.current.backendId}`,
      };
    }
    this.current = {
      running: true,
      backendId: spec.id,
      lines: [`Starting ${spec.id} install…`],
      startedAt: new Date().toISOString(),
    };
    this.queue = this.queue
      .then(() => this.run(spec.id))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.append(`Install failed: ${message}`);
        this.current = {
          ...this.current,
          running: false,
          error: message,
          finishedAt: new Date().toISOString(),
        };
      });
    return { ok: true };
  }

  private append(line: string): void {
    const lines = this.current.lines;
    lines.push(line);
    if (lines.length > MAX_LOG_LINES) {
      this.current.lines = lines.slice(lines.length - MAX_LOG_LINES);
    }
    logger.info(
      { component: "speech", backendId: this.current.backendId },
      line,
    );
  }

  private async run(backendId: LocalSpeechBackendId): Promise<void> {
    const spec = localSpeechBackendSpec(backendId);
    if (!spec) return;
    const onLine = (line: string) => this.append(line);
    this.append(
      `Checking pixi environment "${spec.pixiEnvironment}" (${spec.bootstrapTask})…`,
    );
    const checked = await runPixiLogged(["python", "-c", spec.checkPython], {
      environment: spec.pixiEnvironment,
      onLine,
      timeoutMs: 30_000,
    });
    if (!checked.ok) {
      this.append(checked.reason);
      this.append(`Running ${spec.bootstrapTask}…`);
      const bootstrapped = await runPixiLogged([spec.bootstrapTask], {
        environment: spec.pixiEnvironment,
        onLine,
        timeoutMs: LOCAL_STT_BOOTSTRAP_TIMEOUT_MS,
        frozen: false,
      });
      if (!bootstrapped.ok) {
        this.current = {
          ...this.current,
          running: false,
          error: bootstrapped.reason,
          finishedAt: new Date().toISOString(),
        };
        this.append(`Bootstrap failed: ${bootstrapped.reason}`);
        return;
      }
      const rechecked = await runPixiLogged(
        ["python", "-c", spec.checkPython],
        {
          environment: spec.pixiEnvironment,
          onLine,
          timeoutMs: 30_000,
        },
      );
      if (!rechecked.ok) {
        this.current = {
          ...this.current,
          running: false,
          error: rechecked.reason,
          finishedAt: new Date().toISOString(),
        };
        this.append(
          `Runtime still missing after bootstrap: ${rechecked.reason}`,
        );
        return;
      }
    }
    this.append(
      `Downloading ${spec.defaultModel} into the Hugging Face cache…`,
    );
    if (spec.hfGated) {
      this.append(
        `If this fails with 401/403, run: pixi run --frozen -e ${spec.pixiEnvironment} hf auth login`,
      );
    }
    const downloaded = await runPixiLogged(
      ["python", "-c", spec.downloadPython],
      {
        environment: spec.pixiEnvironment,
        onLine,
        timeoutMs: LOCAL_STT_BOOTSTRAP_TIMEOUT_MS,
      },
    );
    if (!downloaded.ok) {
      this.current = {
        ...this.current,
        running: false,
        error: downloaded.reason,
        finishedAt: new Date().toISOString(),
      };
      this.append(`Model download failed: ${downloaded.reason}`);
      return;
    }
    await this.onInstalled?.(backendId);
    this.append(
      `${spec.id} is installed. Enable it to make it available for speech.`,
    );
    this.current = {
      ...this.current,
      running: false,
      error: undefined,
      finishedAt: new Date().toISOString(),
    };
  }
}
