# Client and server capabilities

> The capability registry names server features, documents what clients do
> without them, and lets code recognize support from a version or explicit bit.

Topic: server-capabilities

## What this solves

A hosted client can update before an installed server. A cached browser bundle
can also lag behind a newly restarted server. Capability checks let each side
use the features the other actually supports. They remain useful even when
every release participates in capability negotiation.

The registry is searchable, browsable documentation alongside executable
definitions: what a capability means, when support began, how to detect it,
and what the client does without it. Most new fixed features are
**version-implied**: the server version establishes support, while the caller
still uses a named capability constant. This avoids scattered version checks
without sending a bit for every feature in every released server.

`capabilities:audit` checks some mistakes in those definitions and their use.
It also reports scheduled reviews of substantial compatibility code. These
are separate jobs: the consistency checks remain useful indefinitely, while
a review date asks whether a particular fallback still earns its cost.
Neither job primarily repairs servers from before capabilities existed.

## Source of truth

| File or symbol | Purpose |
| --- | --- |
| `packages/shared/src/server-capabilities.ts` → `SERVER_CAPABILITIES` | Named definitions, support rules, descriptions and client fallbacks |
| `packages/shared/src/capability-ids.ts` → `CAPABILITY_ID_ALLOCATIONS` | Permanent numeric ID ledger; also owns sparse-bit encoding |
| `serverHasCapability` | Shared interpretation of server version, positive/negative bits and legacy representations |
| `packages/server/src/routes/version.ts` | Chooses supported features and encodes `/api/version` for the client |
| `scripts/audit-server-capabilities.ts` | Static consistency checks and due-date warnings |

Each registry entry records:

- `name`, `id`, `introducedIn`: stable identity and introduction version.
- `advertisement`: whether version, an explicit bit, or a particular response
  establishes support.
- `description` and `serverContract`: the behavior, routes, fields and events
  covered by that name.
- `clientFallback`: what the client does when support is absent.
- `kind` and `lifecycle`: whether the check is permanent or has a specific
  compatibility cleanup worth revisiting.

These are data about capabilities; “registry metadata” does not name another
layer. Support checks use the identity and advertisement fields. Descriptions,
fallbacks and route lists document the contract; the audit checks selected
parts of that documentation. It does not execute a fallback described in prose.

For example, callers can use:

```ts
serverHasCapability(version, SERVER_CAPABILITIES.sessionContentSearch)
```

The entry documents the search endpoint and the title-only fallback. Its
version-implied rule is interpreted centrally. Exported named string constants
and domain helpers are also supported; do not substitute literal feature names
or ad-hoc version comparisons in callers.

Do not duplicate the registry as a hand-maintained ID table here. Allocate the
next unused ID from the ledger, never from a number copied into prose. IDs are
shared across directions and never reused or renumbered. Retired allocated
server capabilities keep their ledger and registry entries.

## How support is recognized

| `advertisement.kind` | Use when | What establishes support |
| --- | --- | --- |
| `version-implied` | Every official release from `introducedIn` onward provides the contract | Server version, or an explicit positive ID from a source build implementing it early |
| `optional-bit` | Support can vary with build, host, configuration or deliberate removal | Explicit positive bit on this server |
| `scoped` | Support belongs to one object or representation rather than the whole server | A capability in that object's response, such as public-share metadata |

Default fixed new features to `version-implied`. They still have a named entry
and, for global capabilities introduced from 0.7.1 onward, a permanent ID.
An untagged build or a source build whose reported version precedes the feature
must explicitly advertise implemented support rather than relying on semver.
Expected variability belongs in `optional-bit` from the outset.

### Exceptional negative overrides

`deniedCapabilityBits` can withdraw a version-implied contract that the reported
version would otherwise promise. A known denied ID wins over the version,
positive bits and legacy names. Unknown IDs and IDs for optional/scoped
capabilities have no effect. The server encoder accepts only registered
version-implied denials and emits them only when its version would imply support.
Legacy name-list responses omit a denied capability's name and also carry
negative override bits when the reported version would imply it. This lets
modern readers use the same withdrawal rule even without encoding negotiation.

This is for an unforeseen withdrawal. Planned experimental or configurable
support uses an optional bit. A possible future compression of permanent
withdrawals remains in [the sketch](server-capabilities.sketches.md).

## What crosses the network

Modern `/api/version` responses carry `current`, `capabilityEncoding: 1`,
sparse `capabilityBits` and, when needed, `deniedCapabilityBits`. Sparse bits
are `[wordIndex, bits]` pairs with empty 32-bit words omitted. Released
version-implied support normally needs no positive bit. The server does not
send registry descriptions, fallback prose, route lists or review dates.

The first application WebSocket notification is `client_capabilities` (after
authentication on encrypted connections). Its version selects the newest
mutually supported encoding; same-origin HTTP supplies that version through
`X-Yep-Client-Version`, and tunneled requests inherit the connection's version.
The version-bearing handshake introduced encoding 1 in 0.7.1. A source build's
git-describe version can establish encoding-1 support even when its preceding
release tag is older. An unparseable server version selects the legacy encoding.

Missing/older client versions select the legacy name list. The shared reader
also accepts intermediate `optionalCapabilityBits`/`capabilityExtensions`
responses; new clients do not negotiate that intermediate representation.
These compatibility readers are existing implementation, not instructions to
create new name-based gates. Transport `formats` have a separate namespace and
meaning; see [remote hosted compatibility](remote-hosted-compatibility.md).

## When to add one

Add a capability when a client-visible action requires server behavior that
supported servers may lack, or availability varies at runtime. The named
contract can cover a new route or a changed meaning of existing fields/events.
Never broaden a released capability to include behavior older servers with
that capability do not implement. A new route added to an old feature may need
a new capability even when its source file is already listed in the registry.

A safely optional response field can instead document absence as its fallback.
For example, an absent issue `trackerStatus` means no badge and adds no request.
An existing endpoint can negotiate an additive response format when reviewed
older implementations safely return the ordinary response. Neither pattern
permits an unsupported write or an optimistic new-route request.

Internal refactors need no capability. Required protocol changes belong in
their protocol version or a deliberate hosted compatibility-floor change;
feature checks do not substitute for those decisions.

## Minimum compatibility horizons

Before changing a client/server contract, inspect the applicable stable-server
corpus and read [remote hosted compatibility](remote-hosted-compatibility.md):

- Optional features: latest two stable releases plus every stable release
  from the preceding 14 days.
- Core functionality: latest two stable releases plus every stable release
  from the preceding 60 days.

Present the affected releases, new routes/fields/semantics, support check and
exact absent-support behavior, including why it sends no unsupported request.
Identify any change to an existing capability meaning or working fallback.
Obtain maintainer approval before changing that contract; an originating
instruction or applicable standing approval already covering the decision
satisfies this requirement. Do not ask for the same approval again.

These windows set the minimum review corpus, not an automatic connection
cutoff. Preserve inexpensive fallbacks. Removing substantial compatibility
code requires a deliberate decision about supported servers, its user-visible
effect and update guidance. Security exceptions follow
[hard development rules](hard-development-rules.md).

## Capability lifecycle classes

Lifecycle is independent of version implication. A permanent capability can
be version-implied; a transitional capability can also be version-implied.
“Permanent” means the named check remains useful, not that a positive bit
must always be sent.

Choose the lifecycle at commit time:

- **Permanent:** “don't show the thing the server can't do and we did not
  choose to emulate.” Keep that check and document its fallback. It needs no
  scheduled transitional review or gap merely because older servers exist.
  Runtime-variable availability also needs a permanent check.
- **Transitional:** keeping compatibility requires substantial alternate
  behavior that may eventually be worth deleting: an older parser,
  reconciliation algorithm, alternate data-loading path or emulation.
  Record the actual code/behavior to reconsider and the condition that would
  make its removal acceptable.

For a transitional entry, `clientFallback` describes the current behavior;
`reviewAfter` schedules reconsideration; `removeClientGateWhen` states the
support condition and required decision. `removeServerAdvertisementWhen` can
record a separate obligation to older clients. Do not schedule a review merely
because a feature is new or a server older than its introduction exists.

### What “transitional review is due” means

The audit has reached the entry's `reviewAfter` date. It does not establish that
the fallback is obsolete or broken, and it does not prevent a commit. The audit
emits a warning for a due date and exits nonzero only for errors. A malformed
date is an error.

At review, choose among retaining a simple permanent check, retaining a costly
fallback with a reason and meaningful next review, or removing compatibility
code after approving the affected support floor. Passing a date or support
window authorizes no automatic removal. Keep ID reservations and server
advertisement needed by maintained older clients even if a current client
branch is removed; current audit rules require allocated server entries to
remain in the registry.

Review notices can be swept in one batch, sharing the release-corpus inspection.
Classify each by its actual fallback code and consequence. Do not clear a batch
by moving dates or deleting checks without that classification. Existing entries
may predate the commit-time policy above; reclassifying their lifecycle need
not change runtime behavior or capability identity.

## What the audit checks

`pnpm capabilities:audit` (also `verify --only capabilities:audit`) reads source
and registry data. It checks:

- Permanent ID validity, uniqueness, ledger continuity and server-entry
  agreement, including introduction versions and optional-bit aliases.
- Required global IDs for capabilities introduced from 0.7.1 onward.
- Certain raw name-based checks in runtime source, encouraging named constants
  and the shared helper.
- Agreement between `serverContract.routes` and declarations in explicitly
  listed `serverContract.routeModules`.
- Transitional review dates, with due dates reported as warnings.

For a route file wholly covered by one capability, list it in `routeModules`.
The audit scans literal `routes.get/post/put/patch/delete` declarations and
compares method plus path suffix against `serverContract.routes`. An added or
removed declaration then prompts an update to the documented route contract.
This works equally for version-implied and optional capabilities. It changes
nothing sent to the client.

This is a limited static check: unlisted files and other declaration forms are
not comprehensively discovered. It does not prove that a route is mounted,
authorized correctly, implemented in the claimed release, or guarded at every
client call site. Nor does it validate the prose describing fallbacks or detect
every possible ad-hoc version comparison. Use behavior tests for those claims.

In particular, adding a route to an old entry can satisfy the audit while still
breaking old-server compatibility. Review the introduction boundary before
deciding whether the new route belongs in that entry or needs a separate one.

## Client Use

Use `serverHasCapability` with a named registry entry, exported constant or
domain helper. Gate a visible action before mounting consumers that would send
unsupported requests. A defensive request-error handler remains useful but
does not replace that check. Missing support follows the documented fallback.

The client shares one `/api/version` snapshot per connected source. Mounting
another component does not trigger another version request; reconnect or
explicit refresh can revalidate it. One source-level owner handles a pending
readiness follow-up. Fixtures for modern global capabilities should use server
versions or allocated bits; tests of legacy encodings can use their old forms.

## Server Use

The version route assembles the implemented set using registry constants and
runtime availability, then chooses the appropriate encoder for the client.
Ordinary reads use retained state: process/build facts are cached per server
generation, and dynamic services own bounded snapshots and in-flight work.
`fresh=1` explicitly bypasses applicable caches. Do not launch Git, package
manager, provider, bridge or sandbox probes for every consumer's normal read.

When acquisition is needed, build metadata, device-bridge status and sandbox
preflight begin concurrently; update lookup begins once the version is known.
Wait for required results before advertising support. Concurrent discovery must
not turn unfinished preflight into an affirmative capability.

`sourceRevision` reports the startup commit/date and changes under `packages/`
for About's display; it does not establish feature support. Likewise optional
`sqlite.state` is a diagnostic, not proof that a discovery endpoint exists.
See [optional SQLite](optional-sqlite.md) for storage readiness.

## Feature-specific contracts

The registry documents individual capabilities. Keep detailed behavior and
release-review evidence in the owning feature topic rather than growing another
registry in this guide. The previous topic's dated reviews are preserved in
[the trims record](server-capabilities.trims.md); they are not today's support
corpus. The following exceptions remain useful entry points.

### Most remaining router policy

`agent-auth-router-most-remaining` covers AAR's reported policy IDs/labels,
per-session policy overrides and admission-refresh evidence. Its unreleased
meaning was broadened on 2026-10-11 without changing a released contract.
See [router policy](agent-auth-router.md#most-remaining-and-admission-refresh).

### New Session bundle negotiation

An existing settings GET negotiates `bootstrap=new-session-v1` with
`Accept: text/event-stream`. Only an event-stream response selects that
protocol; ordinary JSON selects existing-route fallbacks. An interrupted or
invalid stream fails missing parts rather than replaying the bundle as legacy
requests. See [session catalog observation](session-catalog-observation.md#retained-project-discovery-owner).

### Collection reads

`progressive-session-catalog` owns conditional `knownGeneration` reads, not
retained-mode acquisition. Send a generation only for identical query parameters
and when retained rows cover the requested window; cursor pages cannot use it.
Explicit refresh asks for rows. Without support, keep complete enumeration.

`retained-session-collections` separately covers retained sessions/Inbox.
`retained-projects` and `retained-recents` cover their respective collections.
For the latter two existing GET endpoints only, an unknown server version may
receive `summaryMode=retained` as a read preference: reviewed old handlers ignore
it, and absent `catalog` selects the complete-response interpretation. Once the
version is known, absent/denied support omits the parameter. This does not
authorize writes or relax the sessions/Inbox gate. See
[session catalog observation](session-catalog-observation.md).

### Other contract owners

- [Public shares](public-share-persistence.md): representation capabilities belong
  to the selected share/revision; global server support cannot prove one
  stored object has chunk integrity data. Live and frozen chunk support are
  distinct. Unsupported clients retain the bounded ordinary response path.
- [Session sandboxing](session-sandboxing.md): a status API, host availability
  and network-firewall support are separate facts. Launch still rechecks.
- [Project directory storage](project-directory-storage.md) and
  [storage settings](storage-settings.md): advertise complete writer/timing
  semantics, not merely the presence of settings fields.
- [Issues & PRs](issue-session-associations.md): discovery requires ready SQLite;
  GitHub status controls have their own optional capability. Additive content,
  cache-policy and status response fields document their absence behavior there.
- [Computer Control](optional-computer-control.md): retired IDs 70/71 stay
  reserved; Installed Machine Control uses distinct ID 112.
- [Hosted compatibility](remote-hosted-compatibility.md): broad protocol/floor
  decisions, transient client/server skew and separate transport formats.
