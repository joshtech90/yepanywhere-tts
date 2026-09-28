# The tsx loader emits a Node deprecation warning during checks

`pnpm lint`, `pnpm test`, and Playwright runs emit Node's `DEP0205` warning:
``module.register() is deprecated. Use module.registerHooks() instead.`` The
warning comes from the installed `tsx` loader rather than the E2E fixture
changes. The commands pass, but the output violates the warning-free check
standard in `docs/development/code-quality.md`.

Changing the loader or its invocation is a separate dependency/tooling change
with macOS, Linux, and Windows coverage to verify. Check whether a compatible
`tsx` update removes the warning, then run the affected checks on supported
Node versions. This was not folded into the E2E isolation repair.

Found 2026-09-27 while validating the E2E server-isolation pilot.
