# Artifact documents produce browser policy warnings

Chromium reports two warnings while rendering an artifact grant directly:

- `Error with Permissions-Policy header: Unrecognized feature: 'bluetooth'.`
- `An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing.`

Observed through the capture CLI against the running local artifact service.
`packages/server/src/artifacts/ArtifactServer.ts` still emits the unsupported
Bluetooth directive and a CSP sandbox with both permissions. The warning alone
does not establish a sandbox escape: artifact documents have a dedicated origin.
Review the browser-supported permission list and the actual sandbox boundary
under `topics/active-content-security.md` before changing either policy.

The capture helper records these warnings in JSON and Markdown while retaining
usable screenshots. Console errors and failed loads still fail capture. The
service policy remains outside this tooling change because the server file and
its security contract already contain unrelated, uncommitted changes.

Found 2026-09-07 while implementing portable artifact capture tooling.
