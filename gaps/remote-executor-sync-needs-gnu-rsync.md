# Remote-executor session sync fails with macOS's stock rsync

`buildRsyncArgs` in `packages/server/src/sdk/session-sync.ts` always passes
`--protect-args` (`-s`). macOS ships openrsync as `/usr/bin/rsync`
(`openrsync: protocol version 29`), which rejects that option on either end:
as the local client (`rsync: unrecognized option '--protect-args'`) and as the
remote server spawned over SSH (`rsync: invalid option -- s`). Every
`syncSessions`/`syncSessionFile` call then fails, so a Mac running YA, or a Mac
used as an executor host, never syncs transcripts. The SSH test and the remote
Claude launch still succeed, so the session runs but its transcript never
reaches YA's reader.

Not fixed in place because it was found while validating session ids, and
the protected-argument protocol is a deliberate quoting safeguard. Options:
detect openrsync (`rsync --version`) and fall back to quoting remote paths
for the remote shell, or report a clear executor-setup error that names the
GNU rsync requirement on both hosts instead of a raw usage dump.

Found 2026-10-11 while running plan 150's executor probe over loopback SSH.
