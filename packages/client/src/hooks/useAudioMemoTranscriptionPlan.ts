import {
  SERVER_CAPABILITIES,
  VOICE_INPUT_CAPABILITY,
  hasServerCapabilityAdvertisement,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { useModelSettings } from "./useModelSettings";
import { useVersion } from "./useVersion";
import { useBrowserXaiSttApiKey } from "./useBrowserXaiSttApiKey";
import { useRemoteBasePath } from "./useRemoteBasePath";
import { useSpeechSourceRuntime } from "./useSpeechSourceRuntime";
import {
  canSpeechMethodStream,
  resolveSpeechMethod,
} from "../lib/speechProviders/methods";
import {
  reconcileParakeetBackendForModel,
  requestedParakeetModel,
} from "../lib/speechProviders/parakeetModels";
import type { AudioMemoTranscriptionPlan } from "../lib/audioMemoTranscript";
import type { SpeechTranscriptionContext } from "../lib/speechProviders/SpeechProvider";

/** Snapshot the selected STT backend for an audio memo take. */
export function useAudioMemoTranscriptionPlan(
  context: SpeechTranscriptionContext,
): AudioMemoTranscriptionPlan | null {
  const settings = useModelSettings();
  const { version } = useVersion();
  const { hasBrowserXaiSttApiKey } = useBrowserXaiSttApiKey();
  const basePath = useRemoteBasePath();
  const runtime = useSpeechSourceRuntime();
  const selected = resolveSpeechMethod(
    settings.speechMethod,
    version?.voiceBackends,
    settings.hasStoredSpeechMethod,
    {
      directXaiAvailable: hasBrowserXaiSttApiKey,
      browserNativeAvailable: false,
    },
  );
  if (
    !selected ||
    selected === "browser-native" ||
    (hasServerCapabilityAdvertisement(version) &&
      !serverHasCapability(version, VOICE_INPUT_CAPABILITY))
  )
    return null;
  const method = reconcileParakeetBackendForModel(
    selected,
    settings.parakeetSpeechModel,
    version?.voiceBackends ?? [],
  );
  const recentModels = serverHasCapability(
    version,
    SERVER_CAPABILITIES.localSpeechModelSelection.name,
  );
  return {
    method,
    basePath,
    streaming: canSpeechMethodStream({
      methodId: method,
      serverCapabilities: version?.voiceBackendCapabilities,
      ...runtime,
    }),
    options: {
      getTranscriptionContext: () => context,
      openRelayedSpeechSocket: runtime.openRelayedSpeechSocket,
      parakeetModel: requestedParakeetModel(
        settings.parakeetSpeechModel,
        recentModels,
      ),
      whisperModel: recentModels
        ? settings.whisperSpeechModel?.trim() || undefined
        : undefined,
    },
  };
}
