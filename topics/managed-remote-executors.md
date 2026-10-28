# Managed remote executors (retired)

Topic: managed-remote-executors

Status: **operator-only managed SSH prototype removed**, 2026-10-26, under
[core house cleaning](core-house-cleaning.md), row 3. The historical gates
and investigation remain in Git history. No managed execution implementation
is awaiting completion or native SSH stop qualification.

## Current boundary

YA does not inject subordinate provider runners, prepare SSH execution targets
or remote Git workspaces, project controller Codex credentials to targets, or
mirror target transcripts. The managed stdio protocol, diagnostic adapter,
runner build/probes, dedicated tests and internal remote placement records are
removed. The Codex adapter no longer offers the prototype's external ChatGPT
access-token login/refresh configuration. Ordinary local Codex authentication
and independently configured router access remain.

Same-host provider host/workers, socket ownership, reload/reattachment, local
provider adapters and deterministic local fixtures remain. They do not depend
on a managed SSH carrier. A historical executor label cannot enable local
fallback: [released executors](../docs/project/remote-executors.md) are also
retired. Existing remote workspaces, refs, credentials and transcripts are
not inspected, changed or deleted by this removal.

Future cross-machine work should use independently installed, target-owned YA
sessions reached directly or over the encrypted relay, following the separate
[cross-host direction](cross-host-delegation.md). Machine Control's own device
transports and Git SSH remain independent. The old target-discovery/VM-runner
proposal is not a prerequisite for the local core.

[Plan 161](../docs/tactical/161-remove-ssh-executors.md) records the removal
and verification. The former [SSH gate plan](../docs/tactical/119-managed-ssh-executor-baseline.md)
is historical, not an implementation queue.
