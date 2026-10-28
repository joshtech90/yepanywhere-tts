# Remote executors (retired)

Status: **released SSH/rsync executors removed from current source**,
2026-10-26, under [core house cleaning](../../topics/core-house-cleaning.md),
row 2. The original feature/design remains in Git history.

YA no longer launches Claude over SSH, tests executor connections, translates
remote working directories or mirrors provider transcripts with rsync. The
executor settings page, API and new-session selector are removed. Explicit
nonempty executor launch requests are rejected with a removed-feature error.
A New Session URL naming a retired executor displays an error instead of a
local composer.

Historical executor metadata remains readable, including the read-only
`refresh-preview` POST used by hover cards. POST execution actions on those
sessions, including resume, reactivate, restart, clone and fork, return HTTP
410; a caller cannot override the saved remote location by requesting local
execution. Non-HTTP supervisor/provider entry points also refuse SSH launches
and transcript forks, including forks using frozen launch settings. Retired
SSH sessions are excluded before heartbeat transcript discovery and receive no
heartbeat deadline; they cannot abort a sweep before local candidates run.
Existing transcripts, remote workspaces and credentials are not deleted.
Project-level file/Git views are local views, not preserved remote snapshots;
the separate [historical source-identity defect](../../gaps/remote-session-project-views-use-local-files.md)
is not claimed fixed by retiring execution.

Use independently installed YA servers over direct access or the encrypted
relay for remote session ownership. Same-host provider workers and ordinary
local Claude/Gateway/Ollama execution remain. The operator-only managed SSH
prototype is also removed in a separate cut under
[plan 161](../tactical/161-remove-ssh-executors.md), row 3. Shared SSH alias validation remains only for unrelated retained
consumers, not as an execution path.
