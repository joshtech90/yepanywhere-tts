/** Open ASR English short-form snapshot, 2026-09-16; not local dictation WER. */
export const ENGLISH_WER_SOURCE =
  "https://huggingface.co/datasets/hf-audio/open-asr-leaderboard-results/blob/19aa77a9ec5cb8aa353670a97a603794979e75d7/english_short_latest.csv";

const SCORES: Readonly<Record<string, string>> = {
  "distil-large-v3.5": "5.40",
  "large-v3": "5.78",
  turbo: "6.36",
  "nvidia/parakeet-tdt-0.6b-v2": "4.70",
  "nvidia/parakeet-tdt-0.6b-v3": "4.86",
  "nvidia/parakeet-ctc-1.1b": "5.92",
  "nvidia/parakeet-rnnt-1.1b": "5.76",
  "ibm-granite/granite-speech-4.1-2b": "4.62",
  "Qwen/Qwen3-ASR-1.7B-hf": "4.31",
};

export function englishModelWer(model: string): string {
  if (model === "ai-and-i-project/parakeet-tdt-0.6b-v2-hf") {
    return "EN WER 4.70% (upstream v2)";
  }
  if (model === "nvidia/parakeet-unified-en-0.6b") {
    return "EN WER 5.91% (NVIDIA eval)";
  }
  const score = SCORES[model];
  return score ? `EN WER ${score}%` : "EN WER unavailable";
}
