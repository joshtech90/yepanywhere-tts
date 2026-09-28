# Session creation provenance

YA records the client-declared UI that first created a YA-owned session. The
New Session form sends `creationProvenance` on both one-step start and two-step
create requests, for project and detached sessions. User-initiated restart,
fork, and clone actions also mark the successor session. Internal helper
clones remain unmarked. Its `surface` is `web` or
`desktop`. `clientOrigin` is the page's HTTP(S) origin, not a device hostname;
`clientVersion` identifies the frontend bundle; and the desktop wrapper may
also supply its source `clientCommit`. The server bounds and normalizes these
optional values before persisting them in app-data session metadata. They are
descriptive claims, not authentication or access-control evidence.

The first accepted provenance value remains attached to the YA session across
provider restarts and later messages. A creation request that waits for a
worker records it when the session actually starts. Invalid or unknown
provenance is ignored without blocking a session start. Provider-native,
pre-feature, and unmarked API-created sessions have no provenance; YA does not
infer their source from a missing field. Existing session-creator identity for
limited users remains a separate authorization fact.

Session detail, project lists, Global Sessions, and Inbox return this metadata
when present. Global Sessions can filter Web UI, Desktop app, and Unspecified;
the filter is inactive until selected. `session-creation-provenance` gates the
request field and the filter. On an older server the client omits the field and
hides the filter. Older servers accept unknown creation JSON fields but discard
them, so sending one accidentally does not make the provenance durable.

The optional compatibility corpus checked on 2026-09-27 is v0.9.0, v0.9.1,
and v0.9.2. None supports this contract. The new version-implied capability
has permanent ID 84, introduced in v0.9.3. Existing capability meanings and
older fallbacks are unchanged.
