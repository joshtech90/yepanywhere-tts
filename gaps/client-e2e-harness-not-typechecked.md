# The client e2e harness is never typechecked

`packages/client/tsconfig.json` sets `"include": ["src/**/*"]`, and no other
tsconfig in the repository names `packages/client/e2e`, so `pnpm typecheck`
covers none of the Playwright harness — not the specs, and not the support
modules every spec depends on (`global-setup.ts`, `global-teardown.ts`,
`support/ya-server-process.ts`, the fixtures). Playwright runs them through
esbuild, which strips types without checking them.

The failure mode is not a stale annotation but an undefined symbol. While
landing harsh-review item 58 a call site was left referring to a helper whose
local definition had just been deleted and whose import had not yet been added;
`pnpm typecheck` still exited 0. Only the editor's language server reported it,
and without that the whole suite would have failed at run time with
`providerHostRuntimeDir is not defined`.

Not fixed in place because turning the tree on is not a one-line `include`
change: every e2e file currently resolves `node:*`, `process`, `Buffer` and
`NodeJS` against no Node typings under the client's DOM-only compiler options,
so the cheap fix is a separate `tsconfig.e2e.json` with the Node lib/types and
a root script that runs it, plus whatever real errors that first run exposes.
`gaps/server-tests-not-typechecked.md` is the same defect one package over and
has a staged plan worth copying.

Found 2026-09-19 while remediating harsh-review item 58 (one owner for the e2e
provider-host runtime directory).
