/** Local opt-in STT backends that YA can persist in server settings. */

export const LOCAL_SPEECH_BACKEND_IDS = [
  "ya-whisper",
  "ya-parakeet",
  "ya-nemo",
  "ya-granite",
  "ya-qwen",
] as const;

export type LocalSpeechBackendId = (typeof LOCAL_SPEECH_BACKEND_IDS)[number];

export interface LocalSpeechBackendSpec {
  id: LocalSpeechBackendId;
  pixiEnvironment: "stt" | "stt-nemo";
  bootstrapTask: string;
  checkPython: string;
  defaultModel: string;
  /** Hugging Face may require login or a contact/terms gate before download. */
  hfGated: boolean;
  downloadPython: string;
}

export const LOCAL_SPEECH_BACKEND_SPECS: readonly LocalSpeechBackendSpec[] = [
  {
    id: "ya-whisper",
    pixiEnvironment: "stt",
    bootstrapTask: "stt-bootstrap",
    checkPython:
      "from faster_whisper import WhisperModel; from faster_whisper.utils import available_models; assert 'distil-large-v3.5' in available_models()",
    defaultModel: "distil-large-v3.5",
    hfGated: false,
    downloadPython:
      "from faster_whisper import WhisperModel; WhisperModel('distil-large-v3.5', device='cpu', compute_type='int8'); print('whisper weights ready')",
  },
  {
    id: "ya-parakeet",
    pixiEnvironment: "stt",
    bootstrapTask: "stt-bootstrap-parakeet",
    checkPython: "import torch; from transformers import pipeline",
    defaultModel: "ai-and-i-project/parakeet-tdt-0.6b-v2-hf",
    hfGated: false,
    downloadPython:
      "from transformers import pipeline; pipeline('automatic-speech-recognition', model='ai-and-i-project/parakeet-tdt-0.6b-v2-hf'); print('parakeet weights ready')",
  },
  {
    id: "ya-nemo",
    pixiEnvironment: "stt-nemo",
    bootstrapTask: "nemo-bootstrap",
    checkPython: "from nemo.collections.asr.models import ASRModel",
    defaultModel: "nvidia/parakeet-unified-en-0.6b",
    hfGated: true,
    downloadPython:
      "from nemo.collections.asr.models import ASRModel; ASRModel.from_pretrained('nvidia/parakeet-unified-en-0.6b'); print('nemo weights ready')",
  },
  {
    id: "ya-granite",
    pixiEnvironment: "stt",
    bootstrapTask: "stt-bootstrap-granite",
    checkPython:
      "import torch, torchaudio, peft; from transformers import GraniteSpeechForConditionalGeneration",
    defaultModel: "ibm-granite/granite-speech-4.1-2b",
    hfGated: false,
    downloadPython:
      "from transformers import AutoProcessor, AutoModelForSpeechSeq2Seq; name='ibm-granite/granite-speech-4.1-2b'; AutoProcessor.from_pretrained(name); AutoModelForSpeechSeq2Seq.from_pretrained(name); print('granite weights ready')",
  },
  {
    id: "ya-qwen",
    pixiEnvironment: "stt",
    bootstrapTask: "stt-bootstrap-qwen",
    checkPython:
      "import torch; from transformers import Qwen3ASRForConditionalGeneration, Qwen3ASRProcessor",
    defaultModel: "Qwen/Qwen3-ASR-1.7B-hf",
    hfGated: false,
    downloadPython:
      "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-ASR-1.7B-hf'); print('qwen weights ready')",
  },
];

const LOCAL_SPEECH_BACKEND_ID_SET = new Set<string>(LOCAL_SPEECH_BACKEND_IDS);

export function isLocalSpeechBackendId(
  value: string,
): value is LocalSpeechBackendId {
  return LOCAL_SPEECH_BACKEND_ID_SET.has(value);
}

export function localSpeechBackendSpec(
  id: string,
): LocalSpeechBackendSpec | undefined {
  return LOCAL_SPEECH_BACKEND_SPECS.find((entry) => entry.id === id);
}

/** Parse a settings array of local STT backend ids. Null means invalid. */
export function parseSpeechVoiceBackends(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const ids: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") return null;
    const id = entry.trim();
    if (!id) continue;
    if (!isLocalSpeechBackendId(id)) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function unionSpeechVoiceBackends(
  ...lists: readonly (readonly string[] | undefined)[]
): LocalSpeechBackendId[] {
  const ids: LocalSpeechBackendId[] = [];
  for (const list of lists) {
    for (const value of list ?? []) {
      if (isLocalSpeechBackendId(value) && !ids.includes(value)) {
        ids.push(value);
      }
    }
  }
  return ids;
}

export interface SpeechBackendInstallStatus {
  running: boolean;
  backendId?: string;
  lines: string[];
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface SpeechBackendSetupRow {
  id: LocalSpeechBackendId;
  enabled: boolean;
  enabledByEnv: boolean;
  enabledBySettings: boolean;
  advertised: boolean;
  /** Default model files exist locally; independent of runtime validation. */
  modelFilesPresent?: boolean;
  validationStatus?: "pending" | "enabled" | "disabled";
  disabledReason?: string;
  pixiEnvironment: LocalSpeechBackendSpec["pixiEnvironment"];
  bootstrapTask: string;
  defaultModel: string;
  hfGated: boolean;
}

export interface SpeechBackendSetupStatus {
  envBackends: string[];
  settingsBackends: string[];
  advertisedBackends: string[];
  restartAvailable: boolean;
  needsRestart: boolean;
  /** New enablements validate immediately; disabling an active backend needs restart. */
  liveEnablement?: boolean;
  /** The directory used by the server's pixi commands. */
  workingDirectory?: string;
  /** Presence advertises the live Whisper GPU settings route. */
  whisperGpu?: boolean;
  install: SpeechBackendInstallStatus;
  catalog: SpeechBackendSetupRow[];
}
