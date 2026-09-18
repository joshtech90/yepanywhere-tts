# Local speech setup installs only one hard-coded model per backend

The install catalog in `packages/shared/src/speech-backend-setup.ts` installs
each backend's default model. Whisper and Parakeet have separate client model
controls, but the install cards do not expose a persistent server model choice.
Granite's install/cache checks likewise target the default checkpoint.

User-directed v1: put a curated model dropdown in each Install and enable card.
Choose before installing; save one model per backend in server settings. The
backend selector remains backend-only and resolves to that saved model. Install,
download/access links, cache readiness, validation, prewarm, and transcription
must all use the same effective choice. Preserve existing explicit choices and
environment overrides through a documented migration, and avoid replacing an
in-flight worker when changing models.

User-directed v2: optionally list `(backend, model)` tuples in a renamed
Default speech model selector. This allows switching checkpoints without
overwriting the card's sole choice. Keep backend identity distinct from model
identity in saved configuration and availability state. Per-session selection
is a separate scope; today's default applies across sessions on reload.

Curate choices by English dictation quality, warmed single-utterance latency,
memory, punctuation, silence behavior, and keyword biasing. Published batched
throughput is useful screening evidence, not a substitute for those checks.
See `topics/pluggable-speech-recognition.md` for existing runtime contracts.

Compatible backend dependencies should share a pixi environment. Separate
environments are acceptable when dependency constraints require them; a model
choice alone is not a reason to duplicate the runtime.

Found 2026-09-16 while refining backend installation and selection UX;
explicitly deferred by the user to this gap.
Contributing-model: 6-Astra
