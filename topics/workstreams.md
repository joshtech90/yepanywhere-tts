# Workstreams (retired)

Topic: workstreams

Status: **removed from current source**, 2026-10-26, under
[core house cleaning](core-house-cleaning.md), row 1. The original lane
proposal and implementation chronology remain in Git history; there is no
remaining lane scheduler, sync or landing implementation to complete.

## Current behavior

YA no longer creates, registers, seeds or selects managed checkout lanes.
There is no Workstreams page, developer setting, lane API or lane activity
event. New sessions run in their selected project's actual directory. An
explicit legacy `workstreamId` in a project session-start/create request is
rejected with HTTP 410 before provider launch; it is never ignored in favor of
the canonical checkout. The current client sends no lane selector to old or
new servers.

Project discovery no longer groups independent checkouts through the old
workstream registry. Its disposable scan cache is invalidated on upgrade.
Existing checkouts, branches, registry files and provider transcripts are not
moved or deleted. Old URLs may require opening the session from the actual
checkout's project after regrouping. Historical fields do not enable lane
creation or selection.

Ordinary user-created Git worktrees, Source Control and single-checkout
Project Queue remain supported independently. The separate
[worktree file-link defect](../gaps/session-worktree-file-links.md) remains
open. See the [removal plan](../docs/tactical/160-remove-managed-checkout-lanes.md)
for the verified implementation boundary.
