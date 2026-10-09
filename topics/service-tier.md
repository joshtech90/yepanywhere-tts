# Service tier

> Codex offers paid speed tiers (Fast is `priority`, Ultra Fast is
> `ultrafast`) beside the standard tier. YA starts every new session at
> Standard, lets the user opt in from New Session → Advanced or switch live
> from the model panel, and always shows the tier in Session Info so a session
> cannot run Fast without the user knowing.

Topic: service-tier

Status: implemented 2026-10-06; plan in
[148](../docs/tactical/148-codex-service-tier-selection.md).

## Catalog

Codex `model/list` reports each model's `serviceTiers` (`id`, `name`,
`description`) and an optional `defaultServiceTier`. The list can be queried
any time after `initialize`; YA reads it through the existing provider model
inventory, so the tiers arrive with the models in `ModelInfo.serviceTiers`.
Availability is per account and per model: on 2026-10-06 the maintainer's
ChatGPT account offered only `priority` on the Fast-capable models and no
`ultrafast`. YA lists exactly what the catalog offers.

YA never applies a catalog `defaultServiceTier` implicitly, and New Session
never remembers a paid tier. Standard is the only tier a user can end up on
without choosing it. Saved new-session defaults may still carry a
`serviceTier` from older clients; the form ignores it.

## Wire behavior

Validated against `codex app-server` with a mock Responses server that
recorded each request's `service_tier`:

- `serviceTier` on `thread/start`, `thread/resume`, `thread/fork`, and
  `thread/settings/update` sets the thread tier. An explicit `null` selects
  Standard.
- `serviceTier` on `turn/start` is sticky for later turns;
  `serviceTierForTurn` applies to one turn only. YA does not use the latter.
- `thread/settings/update` has no active-turn restriction. It applies from
  the next turn, so a change during a turn does not alter that turn.
- `thread/resume` does not restore a tier, and Codex rollouts do not record
  the initial tier. YA therefore keeps the tier in its own launch settings
  and resends it on every launch and every `turn/start`.

## Selection surfaces

- **New Session → Advanced → Speed.** Standard plus the selected model's
  opt-in tiers. Hidden for router-pool (AAR) selections, which send no tier.
  A non-Standard pick appears in the collapsed Advanced summary.
- **Model panel → Speed.** Chips for Standard and the model's tiers; a tier
  the live process uses but the catalog no longer lists stays visible so the
  user can return to Standard. Selecting a chip applies immediately through
  `POST /api/processes/:processId/config` with `serviceTier` (`null` or
  `"default"` is Standard) and does not close the panel. It is separate from
  model and effort changes because combining it with those would force a
  restart.
- **Session Info → Speed.** Shows the live process tier, else the session's
  saved launch-settings tier, as `Standard` or `Fast (priority)`. Codex
  sessions always show the row; other providers show it only for a
  non-standard tier.

## Server path

`reconfigureProcess` treats a tier-only change on a process whose provider
exposes `setServiceTier` as a dynamic change: Codex sends
`thread/settings/update` and records the tier for later `turn/start`
requests, the process emits `configuration-applied` for `serviceTier`, and
launch settings persist it. Without the provider control, an idle process
restarts with the new tier and a busy one returns 409. Remote provider hosts
forward the control over the provider-session RPC.

The Project Queue new-session target and the session create route already
accepted `serviceTier`; this work only gives them a UI source.

## Compatibility

`process-service-tier-change` (permanent ID 118, version-implied from 0.9.4)
gates only the model-panel Speed control. Released v0.9.0–v0.9.2 return
`serviceTier` from process info and accept it on create and queue, but ignore
it on the process-config route. Without the capability, Session Info still
shows the tier read-only and the client sends no tier change. See
[server capabilities](server-capabilities.md).

## Open questions

- The incident that prompted this work (a session apparently running Fast
  unasked) is unexplained: no saved `serviceTier` existed in the data
  directory, and Codex rollouts do not record the tier. The Session Info row
  makes any recurrence visible.
