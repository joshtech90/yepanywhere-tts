# Service tier

> Codex offers paid speed tiers (Fast is `priority`, Ultra Fast is
> `ultrafast`) beside the standard tier. YA starts unconfigured new sessions at
> Standard, remembers explicit New Session speed choices per provider, and
> supports live changes from the model panel. Session Info always shows the tier.

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

YA never applies a catalog `defaultServiceTier` implicitly. New Session saves
explicit speed choices in server-owned `newSessionDefaults.providers[provider]`
and restores them on later visits and provider switches. An unconfigured
provider starts Standard. Choosing Standard clears both the provider-scoped
tier and the legacy top-level tier. An unavailable saved tier is retained as a
preference while that launch uses Standard; a router-pool launch sends a tier only when both YA and AAR advertise tier-aware selection.
Changing speed in a running session does not change new-session defaults.

This replaces the 2026-10-06 never-remember decision, authorized by the
maintainer on 2026-10-13. No new control, reminder or persistence capability is
added. Released v0.9.0–v0.9.2 already preserve the scoped `serviceTier` field;
older clients may still ignore it when seeding their form.

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
  opt-in tiers. For router-pool (AAR) selections, shown only with negotiated tier support; options come from the selected account, or the union of pool members. Older integrations hide Speed and send no tier.
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

## AAR account pools

Routed Codex speed selection uses response-level `serviceTierSelection`.
Selection/overview responses carry it for New Session; process-model responses
carry it for an existing routed session. Only explicit true enables the control;
absent or false hides it and sends no unsupported tier write. The server checks
AAR's `service-tiers-v1` support. The process-model check is an on-demand local
control read, with no account/provider I/O or state mutation; a disconnected or
unreachable router reports false while model rows remain readable.

The optional-feature review corpus v0.10.0, v0.10.1, v0.10.2 and v0.11.0
lacks these response signals and keeps the existing no-tier routed behavior. An earlier source server that
reports the selection signal but lacks the process-model signal supports New
Session Speed while its live routed panel stays hidden. The existing
`process-service-tier-change` capability keeps its original meaning.

Current clients no longer inspect the global `agent-auth-router-service-tiers`
bit. Its registry entry is retired and ID 136 remains reserved; servers retain
its advertisement for cached older clients. The scoped signal describes the
connected AAR's actual runtime support and is not a fixed YA-version gate with
a 90-day retirement date.

AAR preserves each account's upstream `service_tiers` metadata without
inferring availability from model names or adopting `default_service_tier`.
Automatic allocation filters on the requested tier as well as model and effort;
manual selection refuses unsupported tiers. No eligible account is an explicit
failure, never a silent Standard fallback. Prepared pool bindings recheck tier
support before commit. Tier selections participate in allocation retry identity.

YA remembers the original allocation request independently of later live speed
changes. Resume keeps that request and account pin, then validates the current
launch speed against the pinned account's catalog. Live model/effort/speed
changes validate before mutating the provider. A copied session receives a
separate binding with its current saved speed. No change can silently reselect
an account. An unavailable saved New Session preference uses Standard for that
launch, following the same preference rule as direct sessions above.

For tier-capable routed sessions, Codex reads its native model catalog through
AAR's inference endpoint using `model_catalog_url` and explicit
`api_key_model_discovery`. This prevents its bundled catalog from silently
dropping an account-advertised tier. YA still sends the explicit selected tier
on every turn, including after resume; Standard never inherits a paid catalog
default. Existing sessions expose their pinned account's tiers in the model
panel when its process-model response explicitly reports tier support.

### Verification on 2026-10-29

The official Codex 0.160.0 and pinned 0.165.0 loopback probes exercised a
synthetic model absent from the bundled catalog and captured `priority`, no
tier (Standard), then `ultrafast` after explicit resume. AAR's 225 core tests
and YA's complete workspace checks passed. The New Session browser check kept
all 54 sequential keys below 100 ms during repeated discovery of 48 accounts
(8.4 ms maximum in the captured run); desktop and phone captures were inspected.

A separate disposable YA profile completed four real Codex 0.165.0 turns
through the existing router: new Fast, live Standard, live Fast, and Fast
after a cold YA restart. An unsupported tier returned 409 before provider
mutation. A loopback observer inserted only into the disposable native
transport recorded outgoing tiers; native transcripts established completed
turns. The account, binding and inference token stayed identical across resume.
The provider's response-tier field was absent in AAR metrics, so this proves
request delivery and continuity, not measured latency or actual scheduling
priority. Existing access grants/bindings and the original YA process were
preserved; test integrations were revoked and owned processes stopped.

The live resume emitted the existing Codex turn-id resynchronization warning;
full workspace runs retain the known negative-fixture diagnostics in
[the diagnostic gap](../gaps/full-suite-timing-and-diagnostics.md). No warning
was suppressed and no provider event/timeout handling was changed by this work.
