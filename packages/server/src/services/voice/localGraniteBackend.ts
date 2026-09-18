import { WarmPixiSttBackend, workerScriptPath } from "./warmPixiSttBackend.js";

export const DEFAULT_GRANITE_MODEL = "ibm-granite/granite-speech-4.1-2b";

const GRANITE_REPAIR_HINT =
  "Run `pixi run -e stt stt-bootstrap-granite` from the YA checkout to install the Granite Speech extras (torchaudio, peft). If Hugging Face auth or a gated model is the problem, run `pixi run --frozen -e stt hf auth login` and accept the model terms on Hugging Face. If the error is ENOSPC, free the cache/tmp filesystem or set HF_HUB_CACHE, HF_XET_CACHE, and TMPDIR before starting YA.";

/**
 * IBM Granite Speech through Transformers, in the shared `stt` pixi
 * environment. Granite is a 2B speech-aware LLM: more accurate than YA's
 * 0.6B Parakeet recognizers on the public leaderboards, and slower per
 * utterance because every transcript is generated token by token.
 */
export class LocalGraniteBackend extends WarmPixiSttBackend {
  constructor(opts: { model?: string; device?: string } = {}) {
    super(
      {
        id: "ya-granite",
        label: "Local Granite Speech (pixi stt)",
        logTag: "granite",
        displayName: "Granite Speech",
        workerScript: workerScriptPath(import.meta.url, "granite_worker.py"),
        defaultModel: DEFAULT_GRANITE_MODEL,
        // A 2B generative model loads slower than the 0.6B recognizers, and a
        // cold run also downloads ~5 GB of weights.
        modelLoadTimeoutMs: 300_000,
        repairHint: GRANITE_REPAIR_HINT,
        runtime: {
          backendLabel: "local Granite Speech",
          checkPython:
            "import torch, torchaudio, peft; from transformers import GraniteSpeechForConditionalGeneration",
          bootstrapTask: "stt-bootstrap-granite",
        },
      },
      opts,
    );
  }
}
