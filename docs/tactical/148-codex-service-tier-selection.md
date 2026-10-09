# Codex service tier selection and visibility

Topic: service-tier

Status: implemented 2026-10-06. Maintainer decisions recorded below.

## Existing evidence and boundaries

The task/gap search found no entry for service tiers. The maintainer reported
a session that seemed to run Fast without their choosing it and asked to see
the tier in Session Info, choose it in New Session → Advanced, and change it
mid-session. The server already accepted `serviceTier` on session create,
resume, and the Project Queue new-session target, and persisted it in
`effectiveLaunchSettings`; no client surface set or showed it.

Experiments against `codex app-server` (a standalone probe plus a mock
Responses server recording `service_tier`) established the wire behavior in
[the topic](../../topics/service-tier.md#wire-behavior); most importantly,
`thread/settings/update` changes the tier from the next turn without a
restart, and resume does not restore it.

Maintainer decisions:

- New sessions always start Standard; a paid tier is never remembered.
- A catalog `defaultServiceTier` is never applied implicitly.
- Mid-session changes apply live through `thread/settings/update`.
- A new version-implied capability gates only the mid-session control.

## Steps

### 1 — Provider live tier control

Add optional `setServiceTier` to the agent session and remote provider-host
RPC. Codex sends `thread/settings/update` and keeps the selection for later
`turn/start` requests, since resume would otherwise drop it.

### 2 — Supervisor dynamic reconfiguration

`SessionActivationCoordinator` treats a tier-only change as dynamic when the
process supports it; `Process.setServiceTier` emits `configuration-applied`
so launch settings persist. The process-config route accepts `serviceTier`
(`null`/`"default"` is Standard) and returns the applied tier.

### 3 — Capability 118

Register `process-service-tier-change`, version-implied from 0.9.4, owning the
`serviceTier` request/response field on the process-config route.

### 4 — Client surfaces

Session Info Speed row (live, then saved tier), model-panel Speed chips gated
on the capability, and a New Session Advanced Speed selector that resets to
Standard and hides for router pools.

### 5 — Verification

Codex provider test for `thread/settings/update` and later `turn/start`
tiers without a restart; supervisor test for a live tier change and its
persistence; route parsing tests; model-panel tests; desktop and phone
captures of the three surfaces.
