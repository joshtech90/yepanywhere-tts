# Existing global validation debt during the session-defaults change

The isolated fixed/last-used defaults change passes targeted Biome checks,
settings-route tests, launch-policy tests and the standard-form regressions.
Global checks at base `2a4b73da7` still report unrelated debt:

- `pnpm lint`: six errors and five warnings in `client/index.html`,
  `CockpitPendingInput.tsx`, and Cockpit CSS modules (file-size/specificity).
- `pnpm format:check`: 35 pre-existing format errors in Cockpit owners and
  their core/tests. Exact touched files pass their formatter check.
- `pnpm console:scan`: 91 `console.error` sites against a baseline of 90.
  The defaults change adds no console site or suppressed diagnostic.
- The first full test run hit the existing Groq key-rotation test; the same
  seven-test file passes on targeted retry. An early copy of the new form
  fixture also failed before its loading/remount setup was corrected.

A broad CSS/format cleanup spans unrelated owners and is not safely part of
this settings feature. The diff-aware CSS report explicitly defers ownership
extraction for ModelSettings and NewSessionForm because of coupled shared
rules and dynamic vocabulary. No baseline or timeout was increased.

Found 2026-11-02 while adding fixed versus last-used new-session defaults.
