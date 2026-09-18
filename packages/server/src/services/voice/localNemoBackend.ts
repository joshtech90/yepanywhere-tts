import { PIXI_NEMO_ENV } from "./localSttRuntime.js";
import { WarmPixiSttBackend, workerScriptPath } from "./warmPixiSttBackend.js";

export const DEFAULT_NEMO_PARAKEET_MODEL = "nvidia/parakeet-unified-en-0.6b";

const NEMO_IMPORT_CHECK = "from nemo.collections.asr.models import ASRModel";

const NEMO_REPAIR_HINT =
  "Run `pixi run -e stt-nemo nemo-bootstrap` from the YA checkout for the isolated NeMo runtime. If Hugging Face auth or a gated model is the problem, run `pixi run --frozen -e stt-nemo hf auth login` and accept the model terms on Hugging Face. If the error is ENOSPC, free the cache/tmp filesystem or set HF_HUB_CACHE, HF_XET_CACHE, and TMPDIR before starting YA.";

export class LocalNemoBackend extends WarmPixiSttBackend {
  constructor(opts: { model?: string; device?: string } = {}) {
    super(
      {
        id: "ya-nemo",
        label: "Local NeMo Parakeet (pixi stt-nemo)",
        logTag: "nemo",
        displayName: "NeMo",
        workerScript: workerScriptPath(import.meta.url, "nemo_worker.py"),
        environment: PIXI_NEMO_ENV,
        defaultModel: DEFAULT_NEMO_PARAKEET_MODEL,
        modelLoadTimeoutMs: 240_000,
        repairHint: NEMO_REPAIR_HINT,
        runtime: {
          backendLabel: "local NeMo Parakeet",
          checkPython: NEMO_IMPORT_CHECK,
          bootstrapTask: "nemo-bootstrap",
        },
      },
      opts,
    );
  }
}
