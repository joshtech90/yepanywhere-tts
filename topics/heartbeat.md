# Heartbeat ownership and retained maintenance

Related: [session liveness](session-liveness.md), [session wake](session-wake.md),
[house cleaning](core-house-cleaning.md), [architecture mandates](architecture-mandates.md).

## Synthetic heartbeat retirement

Removed 2026-10-27: periodic provider turns, forced nudges, heartbeat-driven
resurrection, unowned candidate indexing/scans, interval/message/force settings,
project defaults/history, session modal and toolbar toggle. Saved settings are
inert; stale session metadata writes receive HTTP 410. Retired project-default
routes are unavailable and their permanent capability is explicitly withdrawn.
The capability ID remains allocated. No provider prompt replaces these turns.

## Retained transport and provider liveness

Subscription, WebSocket, relay and runtime-lease heartbeats remain health/status
signals. They do not prompt a provider. Server-owned liveness snapshots remain
authoritative and distinguish transport connectivity from provider progress.
Provider events, actual tool output and probes establish activity; browser
renders and idle spinners do not. Normal user input, recaps, wake and cache
keepalive follow their independent contracts.

## Retained maintenance and patient delivery

`SessionMaintenanceScheduler` retains one bounded process-wide deadline owner
for patient-queue checks, including re-planning after done/pause changes.
Done-action finalization runs on idle state changes outside the scheduler.
Patient messages keep
their verified-idle and quiet-period semantics. Exact one-shot patient deadlines,
stale-process and liveness checks remain. With no pending patient maintenance,
the scheduler arms no deadline merely because a historical session exists.
Stopping maintenance cancels future deadlines and joins admitted work without
aborting live provider owners; disposed maintenance cannot rearm.

## Automatic resume exemptions

Explicit Kill/Terminate still persists `autoResumeDisabled`; wake and cold recap
paths retain their shared automatic-resume gate. Archive and automation-pause
protections remain. Ordinary Stop/Interrupt and internal rotation are distinct
from an explicit automatic-resume exemption. Legacy heartbeat fields in raw
stored metadata are inert and redacted from public shares; they no longer
clear or grant automatic resume.
The legacy `heartbeatDisabled` result field remains false for response
compatibility. No transcripts or workspaces are renamed or deleted.

[Plan 164](../docs/tactical/164-remove-retired-session-automation.md) records
verification and independent review.
