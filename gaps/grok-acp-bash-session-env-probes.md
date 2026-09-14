# Grok ACP Bash session-environment probes fail on this macOS host

The following unchanged tests in
`packages/server/test/sdk/providers/grok-acp.test.ts` fail both during
`pnpm test` and when run alone:

- `publishes AGENTCTL_SESSION_ID to Grok Bash tool shells`
- `seeds AGENTCTL_SESSION_ID in the Grok spawn env on resume`

Both fail in `readAgentctlSessionId` at the `execFileSync("bash", ...)` probe
with `Command failed: bash -c printf "%s" "${AGENTCTL_SESSION_ID-}"`.
The probe already uses ignored stdin. The remaining 37 tests in this file
pass. Reproduce with:

```sh
pnpm --filter @yep-anywhere/server test test/sdk/providers/grok-acp.test.ts
```

These probes exercise Grok startup and the inherited Bash environment, not
fork creation. The clone fix does not change those surfaces. The underlying
shell failure still needs diagnosis, including whether the inherited startup
environment is responsible; do not suppress it or relax session identity
assertions. Linux and Windows were not evaluated in this investigation.

Found 2026-09-09 while validating immediate Codex/Pi clone discovery on the
checkout based on `2c03afe5f`.
