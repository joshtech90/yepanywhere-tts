# Cohere Transcribe was requested but has no YA backend

The earlier speech effort recorded Cohere as a candidate in
`topics/pluggable-speech-recognition.md` but did not implement a worker,
registry entry, method, or install card. The user confirmed on 2026-09-16
that Cohere was part of that request. This is distinct from the deferred
multiple-model-per-backend UI.

The user explicitly chose comparison and gap only for this pass; implementation
is deferred.

Target: `CohereLabs/cohere-transcribe-03-2026`, a 2B dedicated ASR model.
Its [official model card](https://huggingface.co/CohereLabs/cohere-transcribe-03-2026)
documents native `CohereAsrForConditionalGeneration` in Transformers >=5.4,
16kHz input, explicit language, punctuation, and chunk reassembly for longer
clips. Use the warm local-worker protocol and the install/enable/access flow.
Do not claim keyword or Smart Turn support without implementing and verifying
the corresponding contract.

Hugging Face requires contact-information agreement before file access.
That blocks an unauthorized model download, not implementing the catalog and
showing a model-page link plus a correctly rooted `hf auth login` command.
Verify cached/authenticated access before downloading; do not log credentials.

Found 2026-09-16 while checking omitted English ASR candidates.
Contributing-model: 6-Astra
