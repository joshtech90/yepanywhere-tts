# Sandboxes share a writable host Claude login; Codex still copies its login

Sandboxed Claude sessions bind-mount the host's `.credentials.json`
writable over their private `CLAUDE_CONFIG_DIR`
(`sharedClaudeCredentials` in `packages/server/src/session-sandbox.ts`).
This replaced a one-time copy that stopped working once either side
refreshed, because Claude rotates its refresh token on every refresh and
the old one dies. On 2026-09-28 one project's copy was emptied by a failed
refresh, so no one could resume its session. 18 of the other 21 sandbox
states held a dead copy. See
[session sandboxing](../topics/session-sandboxing.md#runtime-state-and-scratch-space).

Two defects remain:

- **The sandbox can write the host login.** Reading it was already
  possible through the read-only host view. Writing lets a sandboxed agent
  break the host login, or replace it with another account's so that host
  sessions run under that account. This was accepted as the interim fix
  (maintainer direction, 2026-09-28).
- **Codex sandboxes still copy `auth.json` at bootstrap.** ChatGPT-backed
  Codex logins also refresh, so they are likely to fail the same way. A file
  bind may not carry over, because Codex may save through a rename, which a
  bind-mounted file refuses. Check how Codex writes the file before choosing
  a fix.

Refresh races are also left to the provider. The sandbox's
`.oauth_refresh.lock` sits in its private config dir, not beside the host's
lock. Claude recovers when it re-reads the shared file after losing a
refresh race. If the server treats a reused refresh token as theft,
concurrent refreshes could revoke the login instead.

## Suggested fix: YA-brokered refresh, as an optional setting

Add a server setting, default off, under which sandboxes get a read-only
login that YA keeps fresh from outside the sandbox:

- Mount the host credentials file read-only, so no sandbox can write or
  replace the host login.
- Keep the host token ahead of expiry from the unsandboxed server. Before
  each sandboxed launch, and on a timer while sandboxes run, refresh through
  the provider when expiry is within a margin comfortably longer than the
  margin at which Claude refreshes on its own. That way no sandbox ever
  needs to refresh.
- Handle a sandbox that refreshes anyway: its write fails, and the rotation
  kills the host token. Detect that failure and state it in the session,
  rather than letting later launches fail with the provider's generic
  "OAuth session expired" error.
- Apply the same mechanism to Codex `auth.json`.

A second design, which needs no refresh logic: sandboxed launches use a
long-lived token the operator creates once (for Claude,
`claude setup-token`, passed as `CLAUDE_CODE_OAUTH_TOKEN`). The private
config then holds no refresh token. The host file stays readable through
the host view unless it is also masked.

Found 2026-09-28 while diagnosing a limited user's sandboxed Claude session
that could not be resumed after a YA server restart.
