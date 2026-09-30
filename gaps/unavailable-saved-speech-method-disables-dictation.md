# An unavailable saved speech method disables dictation instead of falling back

When the stored speech method names a backend the server no longer
advertises (for example `ya-granite` while its local model process is not
running), `resolveSpeechMethod` in
`packages/client/src/lib/speechProviders/methods.ts` returns `null` and the
mic is unusable. Nothing chooses another available method or says why. A
published limited-user default can deliver such a method to users who never
chose it: on 2026-09-29 limited users received `ya-granite` while the
superuser's current choice and server default were `ya-grok`.

Not fixed in place because the fallback changes behavior for every user.
Likely fix: resolve an unavailable stored method to the preferred available
one (`getPreferredSpeechMethod`) for this session without overwriting the
stored choice, and show a short note naming the unavailable method.

Found 2026-09-29 while diagnosing limited-user speech defaults.
