# Long-context effort browser check can lose the fork action

`packages/client/e2e/long-context-effort-warning.spec.ts` intermittently reaches
the phone confirmation dialog without its expected **Fork at Max** action.
The 2026-09-21 full browser run during template-source work captured only
Cancel and Change anyway, then timed out waiting for Fork at Max. The same
test passed in the immediately preceding full run. No effort/session code
changed between those runs.

The fixture mocks an owned process as idle through the session, metadata and
process routes. The test itself notes that runtime reconciliation initially
treats an owned session as in-turn until metadata establishes idle. Investigate
whether the phone navigation opens confirmation before that reconciliation,
and whether an already-open confirmation updates when process state changes.
This is a hypothesis, not an established cause. Do not relax the expected fork
behavior or mask a production state-update defect with an arbitrary sleep.

This adjacent failure is outside template-source retrieval. Close with a
deterministic real-browser check that covers delayed idle reconciliation and
forking with the selected effort.

Found 2026-09-21 while verifying project-template source settings.
Contributing-model: 6-Astra.
