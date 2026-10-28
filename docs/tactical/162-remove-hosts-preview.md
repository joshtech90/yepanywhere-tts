# Remove the YA Hosts preview

Status: **implemented and locally verified**, 2026-10-26.
House-cleaning row 11; follows the separate lane and SSH removals in
[plan 160](160-remove-managed-checkout-lanes.md) and
[plan 161](161-remove-ssh-executors.md).

## Scope and retained behavior

Delete the nonfunctional Hosts page, its CSS Module, both local and
relay-scoped routes, lazy/preload entries, Developer toggle, undo-state field,
translations and dedicated page tests. A stale saved preview preference is
ignored. Do not replace the placeholder with an unfinished pairing interface.

Retain browser-saved hosts, current-host identity, host switching, relay
pairing, the monitor, same-host provider ownership and the target-owned
relay/API delegation direction. The owning contract is
[cross-host delegation](../../topics/cross-host-delegation.md).
[Plan 144](144-relay-peer-session-coordination.md) remains a future proposal;
it must introduce a functional surface independently of this retired page.
No grants, host records or provider sessions are deleted.

## Verification boundary

Retain the developer-settings store synchronization test using a supported
relay-debug setting. Remove the preview-only page tests and assertions. Check
the retained settings, ordinary route preloading and sequential typing during
concurrent account discovery. Capture Development settings at 1000×600 and
375×812 through the repository's artifact facility.

Run lint, formatting, typecheck, console/CSS checks and the workspace suite.
Local verification is on macOS; Linux and Windows remain CI coverage. Root
fault-path warnings and SQLite notices are existing recorded test debt;
affected focused tests must remain clean. Shared settings CSS stays in place:
`css:touched` reports only 5% bounded ownership and 31 coupled rules, so moving
it would enlarge this deletion without removing preview-specific code.

## Row 12 scope finding

The registry maps both `gemini` and `gemini-acp` to the ACP implementation;
the stream-JSON adapter is deprecated. Retiring ACP is therefore a choice
between changing ordinary Gemini's execution path, removing Gemini execution,
or deferring the cut. The maintainer explicitly deferred row 12 on
2026-10-26. This preview removal does not change that provider mapping or the
retained Grok ACP client.

## Verification results

- Lint has zero warnings (one unrelated informational suggestion); formatting,
  typecheck, console scan and both CSS checks pass. Removing the dead page
  lowers the console-error budget by one.
- Focused retained settings/store/preload checks: 21 tests pass in 1.33 s,
  without runtime warnings. Workspace: server 6,578 pass in 118.41 s, client
  7,058 pass in 133.10 s; shared, relay and push-broker also pass.
- Three focused browser cases pass. During discovery of 48 accounts, all 54
  sequential keystrokes appear with a maximum measured delay of 9.1 ms.
- Desktop and phone Development settings captures were inspected separately:
  labels, descriptions and toggles remain grouped, with no overflow or stale
  runtime banner. Evidence is under
  `.artifacts/ui-testing/2026-10-26-remove-hosts-preview/`:
  `development-settings-1000.png` and `development-settings-375.png`.
  Captures were presented through the repository facility; the one-time
  capture spec was removed after the check.
