# Cloning a sandboxed Claude session drops its sandbox

`POST /api/projects/:projectId/sessions/:sessionId/clone` copies a Claude
transcript verbatim through `cloneClaudeSession` and copies rewind state, but
unlike its Codex branch (`forkSession` with `inheritedSandboxSettings`, then
`setSessionSandbox`) it records no sandbox metadata for the clone. A clone of a
`project-write` session therefore resumes with `sandboxLevel` none for the
superuser, breaking the "sandbox is settled at creation" rule
([session-sandboxing](../topics/session-sandboxing.md)); for a limited user
the clone is refused at resume instead (`limitExistingSessionLaunch`), so
`/btw` asides, which use clone, do not work for them.

Not fixed alongside harsh-review F12 because it affects every user's clone and
needs its own check of the sandbox state key and project path a copied Claude
transcript should inherit. Cheap fix: in the Claude branch, persist the
source's sandbox with `setSessionSandbox` as the Codex branch does, deciding
whether the clone shares the source's sandbox state key.

Found 2026-09-26 while routing limited users' fork and clone through the
launch policy (harsh review F12).
