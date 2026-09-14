# Runtime cutover checks retain package-manager and console-budget warnings

The immediate runtime cutover passed lint with zero warnings, i18n with zero
warnings and the touched runtime/component tests without runtime warnings.
Two broader checks still report explicitly retained diagnostics:

- `pnpm console:scan` reports 110 ungated chatty call sites, within the existing
  checked-in budget and unchanged by this task. They span transport, upload,
  rendering and device services. Resolving them requires reviewing the owning
  behavior and diagnostic needs across those surfaces; it cannot safely be
  folded into an advisory runtime notice. Follow `topics/console-chatter.md`
  and reduce the baseline alongside each owning fix.
- `pnpm install --no-frozen-lockfile` and Desktop's resource preparation report
  deprecated `@hono/node-ws@1.3.0`, `@types/diff@8.0.0`, and transitive
  `@ungap/structured-clone@1.3.0`, `glob@10.5.0`, `node-domexception@1.0.0`,
  `uuid@9.0.1`, `whatwg-encoding@3.1.1`. The Node-API SQLite addon update removed
  `prebuild-install` and its deprecation. Desktop also
  reports "Shared workspace lockfile detected but configuration forces legacy
  deploy implementation." Replacing the WebSocket/deployment dependency paths
  needs their own transport and desktop artifact validation; keep the current
  physical resource layout rather than removing the legacy flag just to hide
  its warning. The install-script block list also prints its existing ignored
  scripts, intentionally explained in
  [Dependency maintenance](../docs/development/dependencies.md#install-script-allowlist).

Fresh npm installation of the cutover artifact, unlike workspace maintenance,
completed without package-manager warnings. No global warning filter or raised
console budget was introduced. SQLite's accepted upstream experimental notice
remains documented in `topics/server-runtime.md`.

Found 2026-09-08 during server runtime cutover verification.
