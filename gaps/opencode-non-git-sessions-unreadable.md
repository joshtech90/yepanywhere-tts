# OpenCode sessions in non-git directories have no readable transcript

OpenCode files a session started outside a git repository under its `global`
project, whose `worktree` is `/`; the session's own `directory` column holds
the real path. `OpenCodeDbReader.getProjectId(worktree)`
(`packages/server/src/sessions/opencode-db-reader.ts`) looks the project up by
worktree, so for such a session it finds nothing. `getSession` then falls
through to the file-tree and CLI-export readers, and the detail endpoint
returns no messages. A YA-owned session shows only its live output, and a
reload shows an empty transcript.

Reproduced with OpenCode 1.18.32 in `/tmp/oc115/proj` (no `.git`): the
`session` row had `project_id = 'global'` and
`directory = '/private/tmp/oc115/proj'`. The same flow in a git repository
loaded normally.

Not fixed with #115 because it is a separate lookup defect. Likely fix: when
no project matches the worktree, match `global`-project sessions by
`session.directory`. Resolve symlinks before comparing, because macOS reports
`/tmp` as `/private/tmp`. Session listing probably has the same gap
(unverified).

Found 2026-09-23 while reproducing issue #115 with a scripted model.
