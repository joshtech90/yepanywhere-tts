# Local instruction and App browser checks fail during broad verification

The 2026-10-09 full local browser run at 9e28d165f (one worker, no retries)
passed 389 cases, skipped ten and failed eleven. Seven startup/provider and
compatibility fixture failures were repaired and pass focused reruns. These
four remaining failures were outside the New Session acquisition changes:

- `packages/client/e2e/limited-instructions.spec.ts`: the first shared
  instruction textbox was absent on the component fixture page.
- `packages/client/e2e/project-app.spec.ts`: Live preview did not receive its
  `/app/start` response within five seconds.
- The app-inventory case could not find the `canvas` app button.
- The phone App case failed its setup because sandbox status was
  `probe-failed`, rather than `available` with `bubblewrap`.

The app failures may share the unavailable sandbox, but that attribution is
unproved. This run also logged a Vite dependency-scan error for a component
fixture; inspect the retained stderr before attributing the instruction case.
No assertion or timeout was relaxed. The run's teardown and process sweep
completed cleanly. The separate relay check and final quick checks passed.

These are distinct from the previously reported App pane handoff failure,
which reached a new session but lost its iframe. Reproduce these cases
with their isolated fixtures before changing application behavior.

Found 2026-10-09 during New Session startup regression verification.
Contributing-model: 6-astra.

## Narrowed 2026-10-11

CI 38129869711's inventory trace establishes that the fixture never mounted
`/api/settings`: the SPA fallback returned HTML, leaving acting-principal
resolution pending and withholding the Apps pane. The fixture now mounts real
settings/auth services and serves the invocation's built frontend. This also
removes cold session-route transforms that consumed the handoff assertion.
The inventory and handoff cases pass focused local verification with unchanged
assertions. The inventory and handoff findings are resolved; the instruction,
live-preview/sandbox and row-height findings still require their own evidence.

## Recheck 2026-10-10

At `debb025bb`, the full browser run passed 392, skipped ten and failed ten.
The initial shared instruction textbox and `canvas` app-inventory button were
again absent. The earlier Live preview and phone sandbox cases passed this
time; their previous failures remain intermittent and unexplained.

An additional failure in `packages/client/e2e/session-right-pane.spec.ts`,
“Apps saves on defocus without losing typing during a pending save”, reached
its desktop row geometry assertion: the measured row height was exactly 72 px,
while the assertion requires less than 72 px. No lost-keystroke assertion
failed. Inspect the rendered row and its intended density before changing the
layout or assertion; the boundary has not been relaxed.

Two legacy-server fixture failures from this same run were repaired separately:
the fixtures now emulate ordinary settings JSON instead of the new startup
bundle, preserving their mocked old version. Both focused reruns pass.
The other five failures are recorded in
[artifact viewer readiness](artifact-viewer-edit-mode-readiness.md).
The broad suite was not rerun after the test-only compatibility correction.

Local evidence: `packages/client/test-results/9ebe4732-5fad-49db-945a-f9ab17b547b5/`;
retained stdout/stderr: `/local/graehl/ya-boot/final-deep-browser.{out,err}`.
Attribution to production code versus fixture/dependency state is unresolved.
No timeouts or geometry expectations were weakened. Process sweeps were clean.
Contributing-model: 6-astra.

## Recheck 2026-10-17

The broad 421-case browser run during Android transport qualification passed
406, skipped ten and failed five. The stopped-process App case at
`packages/client/e2e/project-app.spec.ts:352` again failed to expose “Stop serving
at this address.” Its retained UI error says project-write sandboxing requires
Linux/Bubblewrap on this macOS host. This narrows that attempt's failure; it
does not settle the other historical instruction/geometry cases. No product
behavior, assertions or timeouts were changed for this unrelated platform gate.

## Recheck 2026-10-23

Two consecutive post-publish browser runs on this Linux host each failed
different App cases. At `92b0d2f91` (plus WIP), 427 passed and two failed:
the Live preview reload at `project-app.spec.ts:165` and the image-upload
quality case. At `1db2e30b7`, 428 passed and one failed: the app inventory at
`project-app.spec.ts:282`, where "Copy viewer link" never appeared within 5 s.
Run alone, the inventory case then passed three times in a row. Both commits
touched only provider markers and a unit test, so these are still
intermittent failures that the full run triggers. The cause is unproved.
Contributing-model: claude-opus-5-5.

## Narrowed 2026-10-26

The latest publish again exceeded the five-second `/app/start` response wait.
That endpoint waits for process readiness before responding. The Live preview
case now allows 20 seconds, four times the observed limit, and preserves its
real reload assertions. This addresses the response budget only; the other
instruction, sandbox, inventory and geometry findings remain separate.
Contributing-model: 6.1-Sol.
