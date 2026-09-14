# YA's Smart Turn timeout exceeds xAI's documented maximum

`packages/client/src/lib/speechProviders/SpeechProvider.ts` allows 10000 ms.
Both `DirectXaiStreamingSpeechProvider.ts` and the server's
`services/voice/xaiSttBackend.ts` forward positive values without restricting
them to xAI's currently documented 1–5000 ms range.

The [xAI STT reference](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text)
was checked on 2026-09-08. Actual upstream rejection above 5000 ms was not
tested. This was kept separate from the microphone-lifetime fix because
changing a persisted setting's interpretation needs a coordinated decision
for the controls, both xAI paths, and older clients/servers.

Reconcile the vendor range with the shared setting, preserve stored values
explicitly, and test the resulting behavior at 5000 and 10000 ms.

Found 2026-09-08 while investigating tablet speech recognition.
