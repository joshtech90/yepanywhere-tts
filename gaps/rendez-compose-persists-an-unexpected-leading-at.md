# Rendez compose sometimes persists an unexpected leading @

At `f0f4f6b36`, the first attempt of
`packages/client/e2e/rendez-compose.spec.ts`, “active-compose attaches to a
new-session draft while real typing continues”, persisted
`@Explain this screenshot` instead of `Explain this screenshot`. The
15-second exact draft-value assertion failed; the first retry passed.

Evidence: [CI 40756007588, browser shard 2](https://github.com/kzahel/yepanywhere/actions/runs/40756007588/job/123054973087),
artifact `e2e-failures-shard-2-1` (ID `12847580065`). The first-attempt
screenshot and error context and the retry trace are retained there. This is
an unexplained intermittent input/draft defect; a retry pass is not a repair.

The adjacent Source Control retirement does not change New Session, Rendez,
composer input or draft persistence. Its deterministic capability-fixture
failure is being repaired separately. Before changing product behavior,
capture the editor value and draft revision before typing and at each input:
distinguish inherited/restored draft text from insertion during typing. Keep
the exact text, sequential-input and 100 ms assertions; do not strip the @
or extend the wait to hide it.

Found 2026-10-28 while following Source Control retirement CI.
