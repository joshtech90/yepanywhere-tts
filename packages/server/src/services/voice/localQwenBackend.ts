import { WarmPixiSttBackend, workerScriptPath } from "./warmPixiSttBackend.js";

export const DEFAULT_QWEN_MODEL = "Qwen/Qwen3-ASR-1.7B-hf";

/** Qwen's native Transformers recognizer shares the optional stt environment. */
export class LocalQwenBackend extends WarmPixiSttBackend {
  constructor(opts: { model?: string; device?: string } = {}) {
    super(
      {
        id: "ya-qwen",
        label: "Local Qwen3 ASR (pixi stt)",
        logTag: "qwen",
        displayName: "Qwen3 ASR",
        workerScript: workerScriptPath(import.meta.url, "qwen_worker.py"),
        defaultModel: DEFAULT_QWEN_MODEL,
        modelLoadTimeoutMs: 300_000,
        repairHint:
          "Run `pixi run -e stt stt-bootstrap-qwen` from the YA checkout to install Qwen3 ASR support.",
        runtime: {
          backendLabel: "local Qwen3 ASR",
          checkPython:
            "import torch; from transformers import Qwen3ASRForConditionalGeneration, Qwen3ASRProcessor",
          bootstrapTask: "stt-bootstrap-qwen",
        },
      },
      opts,
    );
  }
}
