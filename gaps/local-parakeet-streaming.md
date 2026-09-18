# Local Parakeet backends expose only batch recognition

`ya-nemo` runs the warm `nemo_worker.py` batch protocol even though its default
Unified English model supports buffered streaming. Speech is transcribed after
recording ends; no local partial transcript appears during capture.

User-requested follow-up: implement streaming for NeMo Unified English through
YA's existing streaming speech contract, including incremental audio, partial
versus final transcript semantics, flush on stop, cancellation, disconnect
cleanup, and bounded buffering. Advertise streaming only for a verified
model/runtime pair. Preserve the batch path and explicitly selected models.
Streaming is independent of Smart Turn send/cancel/wait decisions.

Check Transformers `ya-parakeet` support as well. A TDT decoder or a fast batch
model does not itself establish a supported stateful streaming interface; do
not advertise it until the selected model and installed Transformers runtime
have a verified path. Avoid treating repeated full-clip batch decoding as
equivalent to native streaming.

[NVIDIA's Unified model card](https://huggingface.co/nvidia/parakeet-unified-en-0.6b#streaming-inference)
documents buffered RNNT streaming and context settings from 160 ms to 2.08 s.
Those are chunk plus right-context delays, excluding compute and network time.
Measure end-to-end partial/final latency and recognition quality on the same
English clips at several context settings; include silence, technical terms,
long utterances, and mid-utterance cancellation. YA has not run this comparison.

Compatible backends should share a pixi environment; isolate incompatible
dependency sets when needed. Do not upgrade the shared runtime without checking
the existing Whisper, Granite, and Transformers Parakeet paths.

Contract: `topics/pluggable-speech-recognition.md`.
Found 2026-09-16 while comparing local speech models; explicitly deferred by
the user to this gap.
Contributing-model: 6-Astra
