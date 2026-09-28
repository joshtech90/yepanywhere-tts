# Sandboxed shells cannot read the session-ID bridge in host tmp

In the scooter-parkour template session on 2026-09-28, the shell had an empty
`AGENTCTL_SESSION_ID` and a configured `BASH_ENV` under
`/tmp/ya-agentctl-session-*/bash-env.sh`; reading the latter failed because it
did not exist inside the sandbox.

`sdk/providers/agentctl-session-env.ts` creates the bridge and atomically
updated session environment file under host `tmpdir()`. The production
`session-sandbox.ts` wrapper replaces `/tmp` with the project's private temp
directory. The Claude adapter still passes the original bridge path.

Expose only this launch's bridge directory read-only inside its sandbox, or
allocate it through an equivalent explicit sandbox-aware mechanism. Preserve
late publication and atomic replacement: mounting a single environment-file
inode is insufficient. Do not expose other sessions' bridges or copy stale
launcher identity. This is independent of importing optional global AGENTS.

Verify an actual wrapped Bash subprocess before and after late publication,
including a changed published ID, and verify unrelated host-temp files remain
hidden. Cover fresh and resumed launches. The observed failure is not a
limited-user permission policy.

Found 2026-09-28 while inspecting a template-created session.
Contributing-model: 6-Astra.
