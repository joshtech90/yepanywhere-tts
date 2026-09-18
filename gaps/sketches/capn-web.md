# Consider Cap’n Web only after naming YA’s existing JSON/RPC-like wires

[Cap’n Web](https://github.com/cloudflare/capnweb) (Cloudflare, Kenton Varda,
2025-09) is a schema-less JavaScript RPC: JSON with a little wrapping,
TypeScript types only, HTTP / WebSocket / `postMessage`, pass object and
function stubs by reference (holding the stub is the permission), promise
pipelining, ~10–16 kB. No use in this checkout. The question is whether any
YA JS-to-JS boundary would want it. That is not a decision yet.

## What YA already speaks (JSON-RPC-like and not)

Two different layers get called “the provider service.” Only the first is
YA’s; the second is the harness.

### YA client ↔ YA server — not JSON-RPC

This is the surface a browser or hosted client uses.

- **REST JSON over Hono** (`/api/*`). Ordinary HTTP methods and paths. Direct
  localhost uses `fetch`. This is the application API.
- **Relay / mux WebSocket** (`packages/shared/src/relay.ts`). One socket
  multiplexes an **HTTP-like envelope** (`{ type: "request", method, path,
  headers, body }` → `{ type: "response", status, body }`), plus
  subscribe/event, upload chunks, ping/pong, speech, client capabilities. The
  server dispatches requests by calling `app.fetch` on the same Hono app. The
  relay is a transport around REST, not a second RPC.
- **Live channels.** Session, activity, session-watch, glossary, worktree, and
  the experimental conversation subscribe are typed event streams (SSE on
  localhost, `type: "event"` frames on the mux). Server-push already exists;
  it is not method-call RPC.
- **Simple Client Conversation API.** A smaller typed REST + subscribe
  contract for non-React clients. Still HTTP-shaped, not JSON-RPC.
- **Artifact origin.** Isolated HTTP with grant tokens. Holding the grant is
  already the permission; the bytes are just files.

Kotlin/Android and curl talk this same REST/mux world. A JS-only RPC library
cannot become the canonical client protocol without a second native
implementation.

### YA provider host — RPC-like, local, not web

When a capable Linux/macOS Node source checkout runs the shared provider host
(`topics/provider-host-api.md`):

- **Host control socket** — protocol v3, newline-delimited JSON over a
  same-user Unix socket. Each request has `id`, `token`, `op`
  (`launch`, `sessionTurn`, `interruptSessionTurn`, …), not JSON-RPC 2.0
  `method`/`params`/`jsonrpc`. No TCP. Token file is the capability.
- **Worker socket** — protocol v1, private Unix socket. Queue pushes,
  sequenced `SDKMessage` events with acks, permission/approvals, and
  “provider controls/RPC” for steer/model/compact. Hono’s `Process` is a
  **proxy** onto this worker. The worker, not Hono, owns the harness child.

When that host is absent, the same `AgentProvider` / `AgentSession` objects
run **in-process inside Hono**. Either way the TypeScript seam is a class
interface (`startSession`, async iterator, `queue`, `abort`, `steer`), not a
URL.

Proposed but not built: [core service API](../../topics/core-service-api.md)
(deliberate headless REST around that runtime) and
[agent-session-access](../../topics/agent-session-access.md) (scripts over
REST). Those proposals stay HTTP on purpose so curl and agents can use them.

### Provider harnesses — vendor protocols YA adapts

YA does **not** present a web RPC to Claude/Codex/pi/Grok. Each adapter
speaks that harness’s native wire:

| Harness | Wire | Shape |
|---|---|---|
| Claude | Agent SDK `query()` | in-process / subprocess iterator, not JSON-RPC |
| Codex app-server | stdio | JSON-RPC 2.0 (`jsonrpc: "2.0"`), notifications until `turn/completed` |
| pi `--mode rpc` | stdin/stdout JSONL | JSON-RPC, `agent_settled` as the turn boundary |
| Grok ACP | stdio (also `grok agent serve` WebSocket) | ACP = JSON-RPC 2.0 |
| Gemini ACP | stdio | ACP JSON-RPC |
| OpenCode | `opencode serve` | HTTP + SSE, not JSON-RPC |
| Codex computer-use / Sky | native local IPC | length-prefixed JSON-RPC (observed; not a YA protocol) |

MCP (JSON-RPC over stdio) is not a YA client-server protocol. Providers may
run MCP servers; YA has only sketched an MCP adapter as a later consumer of
core-service operations. Device-bridge agent control uses command JSON
(`{"cmd": "snapshot"}`) over the existing APK TCP link, also not JSON-RPC.

**Answer to “is the provider service web RPC?”** No. The YA-owned provider
service is an in-process TypeScript `AgentProvider` that may be reached
through local NDJSON Unix sockets. Web clients never call it directly. They
call Hono REST; Hono talks to `Process`; `Process` either is the adapter or
proxies the host worker; the worker speaks the vendor protocol above.

## What Cap’n Web would add

From the 2025-09 Cloudflare write-up and the `cloudflare/capnweb` README
(experimental; TS erased at runtime unless you add `capnweb-validate`):

- Call remote objects as if they were local JS, over HTTP batch, WebSocket, or
  `postMessage`.
- Return a stub from `authenticate()`; later calls go to that object. Forging
  the stub is not possible. Bidirectional callbacks.
- Promise pipelining: `session.whoami()` on the promise from `authenticate()`
  is one round trip. `.map()` on a promised array is a recorded pipeline, not
  shipped JS.
- No schema compiler. TypeScript interface is the contract.

## Advantages against YA’s actual wires — few, and not on the provider path

**Do not replace vendor JSON-RPC.** Codex, pi, ACP, and Sky own those
protocols. Cap’n Web cannot sit in front of `codex app-server`.

**Do not replace client REST / relay mux as the product API.** Hosted clients,
Android, capability bitsets, curl, and the “relay is HTTP over WS” fact are
load-bearing. A JS-stub API would be a third client protocol. Pipelining
would flatten some REST waterfalls (`GET session` then `GET messages`), but
the Conversation / simple-client path already projects a window on the
server. Bidirectional push is already subscribe/event. Artifact grants
already treat “holding the token” as permission, without object stubs.

**Possible niches, none justified yet:**

1. **Interactive HTML / artifact iframes.** [Interactives](../../topics/interactives.md)
   already cites MCP Apps `ui/*` JSON-RPC over `postMessage`. Cap’n Web’s
   native `postMessage` transport and stub-as-permission match that sandbox
   better than REST. Closest real fit; still competes with adopting MCP Apps
   rather than inventing a YA RPC.
2. **Provider-host or worker Unix sockets**, if those custom NDJSON protocols
   grow enough that pipelining and returned session stubs beat new `op`
   fields. Both ends are already JS. Local, same-user, no browser. A new
   experimental library is a weak trade for a working v3 host protocol.
3. **Hono `Process` ↔ worker** “provider controls/RPC” as JS method stubs
   (`session.steer()`, `session.compact()`) instead of ad hoc control
   messages. Same caveat: JS-only, experimental, rewrite of a loaded path.

Tiny bundle size is irrelevant on the server and small compared with the
existing client. Schema-less is not a win here: YA already uses TypeScript
plus explicit wire types and capability IDs, and hosted-client compatibility
needs those IDs to stay stable.

## Activating difference (2026-09-15)

Stub-as-permission — object and function stubs, holding the stub is the
right to call it — is the only reason to reach for Cap’n Web. Nothing else
is an independent product difference on YA’s current wires.

If a stub-shaped JS-to-JS API did exist (an artifact iframe host object, a
returned worker session), promise pipelining and callback stubs come along
as *how that API stays one round trip*, not as a second reason to adopt.
They do not justify replacing REST or vendor JSON-RPC.

Cap’n Web stubs are live references on one RPC connection. They die with
the socket. YA’s artifact grants, share links, and provider-host tokens are
durable HTTP/file capabilities. Stubs do not replace those; they only help
where a JS caller should hold a transient object it cannot forge.

`postMessage` as a built-in transport is convenience. MCP Apps already
speaks JSON-RPC over `postMessage`. Size and “no schema compiler” stay
irrelevant.

## Why not implement

No concrete call site hurts for lack of pipelining or object stubs. The
provider path is the wrong layer. Replacing REST would strand Android and the
relay envelope. The only plausible experiment is artifact-iframe `postMessage`,
and that should be compared with MCP Apps first. Cap’n Web is still labeled
experimental by its authors.

Related: [core service API](../../topics/core-service-api.md),
[provider host API](../../topics/provider-host-api.md),
[source transport](../../topics/source-transport.md),
[provider abstraction](../../topics/provider-abstraction.md),
[interactives](../../topics/interactives.md),
[simple client API](../../topics/simple-client-api.md).

Found 2026-09-15 from a request to consider Cap’n Web and to name YA’s
existing JSON/RPC-like surfaces first.
Contributing-model: grok-4.6
