# Fork-wide quality checks fail outside the update compatibility fix

The 2026-11-01 upstream merge builds and passes 6,834 server tests and
415 Cockpit tests. The focused formatter check for
`packages/client/src/cockpit/useCockpitSessionDetail.ts` passes.

Whole-tree checks still fail:

- `pnpm lint`: 6 errors and 5 warnings in existing Cockpit styles,
  `CockpitPendingInput.tsx`, and `packages/client/index.html`. These files
  are byte-identical to the pre-merge fork HEAD `b1a189840`.
- `pnpm format:check`: 37 formatting errors across the existing Cockpit.
- `pnpm console:scan`: error-call count 91 against a ceiling of 90.

Do not hide these by relaxing limits. The CSS specificity and size findings
need a separate bounded cleanup with visual verification; changing cascade
order or splitting styles during an upstream update would broaden runtime
risk. Format cleanup should be a separate mechanical commit, as required by
`docs/development/code-quality.md`. Compare console scan JSON against the
pre-merge fork to identify and justify or remove the additional error site.

Found 2026-11-01 while updating the maintained Cockpit fork from upstream.
