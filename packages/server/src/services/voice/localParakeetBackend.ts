import { WarmPixiSttBackend, workerScriptPath } from "./warmPixiSttBackend.js";

export const DEFAULT_PARAKEET_MODEL =
  "ai-and-i-project/parakeet-tdt-0.6b-v2-hf";

const PARAKEET_REPAIR_HINT =
  "If Hugging Face auth or a gated model is the problem, run `pixi run --frozen -e stt hf auth login` and accept the model terms on Hugging Face. If the error is ENOSPC, free the cache/tmp filesystem or set HF_HUB_CACHE, HF_XET_CACHE, and TMPDIR before starting YA.";

export class LocalParakeetBackend extends WarmPixiSttBackend {
  constructor(opts: { model?: string; device?: string } = {}) {
    super(
      {
        id: "ya-parakeet",
        label: "Local Parakeet (pixi stt)",
        logTag: "parakeet",
        displayName: "Parakeet",
        workerScript: workerScriptPath(import.meta.url, "parakeet_worker.py"),
        defaultModel: DEFAULT_PARAKEET_MODEL,
        modelLoadTimeoutMs: 180_000,
        repairHint: PARAKEET_REPAIR_HINT,
        runtime: {
          backendLabel: "local Parakeet",
          checkPython: "import torch; from transformers import pipeline",
          bootstrapTask: "stt-bootstrap-parakeet",
        },
      },
      opts,
    );
  }
}
