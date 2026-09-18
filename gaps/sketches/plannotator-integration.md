# Plannotator UI reach: HTTP browser app, not an X11 display

[Plannotator](https://github.com/backnotprop/plannotator) is a **temporary
local HTTP server plus a browser page**, not a Linux GUI that needs an X
display, VNC, or xterm forwarding. The integration YA would actually need is
getting that page to the **user's** browser when the agent runs on the YA
host and the user is on localhost, Tailscale, or a hosted client through the
relay.

Docs last checked against Plannotator OSS v0.27.15 (installed at
`~/.local/bin/plannotator`, 2026-09-15). This checkout has never driven a
review through YA.

## What it is

The `plannotator` binary starts a Bun HTTP server, prints a URL, and (locally)
opens the system browser. Plan review, annotate, HTML, and code review are
that web UI. Skills and harness hooks (`ExitPlanMode`, `submit_plan`,
`/plannotator-annotate`, `/plannotator-review`, `/plannotator-last`) launch
that server and wait for approve/deny; structured feedback returns as the
agent's next input.

It is not an X11 app. `PLANNOTATOR_BROWSER` / `BROWSER` only choose how to
**open a URL**. Headless hosts should set `BROWSER=none` (or remote mode) so
it does not try to spawn a display-side browser.

### Bind and URL (from their remote.ts and remote-access docs)

| Mode | Listen | Port | Browser open | Auth |
|---|---|---|---|---|
| Local | `127.0.0.1` | random | auto | none |
| `PLANNOTATOR_REMOTE=1` | `0.0.0.0` | 19432 default | often skip; print URL | **none** |
| `--tailscale` (v0.27+) | stays `127.0.0.1` | Serve proxy | prints HTTPS + QR | Tailscale, not Plannotator |

`PLANNOTATOR_URL_HOST` changes only the advertised URL, not the bind.
Remote mode on `0.0.0.0` is an unauthenticated HTTP server; their docs say
do not publish it. Settings use a **localhost cookie**. HTML review is a
sandboxed iframe with relative assets from the file's directory.

**Static port, no replace.** `PLANNOTATOR_PORT` pins a port (or an inclusive
range). Local default is random (`0`); remote default is 19432. A **fixed**
port that is already bound is retried five times (500 ms) then errors
(`Port N in use after 5 retries`). Plannotator does not kill the occupant;
their troubleshooting is `lsof -ti:N | xargs kill` then retry. There is no
`--replace` / `--force` flag. So a stable `plan.localhost` vhost can use
`PLANNOTATOR_PORT=19432`, but the old process must be gone first — YA should
not rely on Plannotator to forcibly take the port.

The old `--render-html` flag is a no-op; local `.html` renders as a page by
default.

## What YA should not do

- X11 / VNC / xterm GUI forwarding. Wrong shape.
- A second feedback injector. Plannotator already writes the next provider
  user turn. YA should show the UI and leave that loop alone.
- Reuse the artifact **file-grant** path as if Plannotator were a static
  `.html` tree. Artifact serving "does not rewrite JavaScript, emulate an
  application backend, or run a project's dev server"
  (`topics/active-content-security.md`). Plannotator **is** a live app
  (review APIs, cookies, approve/deny). Serving a captured HTML export is a
  different, weaker product.

## How the user's browser can reach it

**No extra cloudflared tunnel.** Artifacts already share YA's listening port
by Host: `http://artifacts.localhost:<YA port>` hits the same socket as
`http://localhost:<YA port>`; the main listener dispatches on `Host` before
YA APIs. One SSH/port-forward, one public artifact listener (`127.0.0.1:4402`
behind the existing tunnel). Plannotator and other loopback HTTP UIs should
ride that, not a second ingress.

Keep the child bound to loopback; do not set `PLANNOTATOR_REMOTE=1` just to
punch `0.0.0.0`. Use **`.localhost`** (RFC 6761, resolves to loopback), not
`.local` (mDNS). Grant mint stays on the authenticated YA/relay transport;
bytes go through the Host-dispatched proxy.

The YA **relay mux is not a generic HTTP reverse proxy**. It carries YA REST
and subscriptions. Do not stuff Plannotator's HTML/API into
`RelayRequest { method, path }`.

Bypass options, not YA work: Plannotator `--tailscale`; SSH `-L` of the
HTTP port (not X11).

### Local: static table (landed) vs dynamic helper (postponed)

**Static table** is on Settings → Local Access, below the artifact fields.
Each row is `name`, `port`, optional env var. `name.localhost` on YA's
port reverse-proxies to `127.0.0.1:port` even when the public root is
empty. Public root (e.g. `graehl.org`) also matches `name.graehl.org` on
the artifact listener. An env name is exported to new local provider
sessions as that port (`PLANNOTATOR_PORT=19432`). Normal Plannotator
close is enough; YA does not kill a busy port.

**`ya-vhost` PATH helper is postponed.** The earlier checkbox +
`ya-vhost <subdomain> <port>` design remains the agent API for dynamic
maps; do not implement it in this slice.

### Preferred agent API: PATH helper + Local Access checkbox

Because Plannotator will not steal a busy port, the stable setup is a YA
callable that **updates the vhost table**, not a second process killer.

**Settings → Local Access**, default off ([[vanilla-defaults]]): checkbox
"dynamic vhost proxy". When on, eligible provider launches get the existing
private command directory on `PATH` (same channel as `ya-agent self`) with a
helper, e.g. `ya-vhost <subdomain> <port>` (or `ya-agent vhost` if we keep a
single dispatcher).

- `<subdomain>` is one DNS label (`plan`, not `plan.graehl.org`). Reject
  dots, empty, and reserved names (`localhost`, `artifacts`, `relay`, `www`,
  `ya`).
- `<port>` is the already-listening loopback HTTP port (Plannotator after
  it prints a URL, or a pinned `PLANNOTATOR_PORT`).
- Re-running the same subdomain **replaces** the previous map (the
  force-replace that Plannotator itself will not do). Do not SIGKILL
  whatever is on that port unless we later add an explicit, pid-checked
  flag.
- Print both URLs the map actually enables. Drop the map when the session
  ends, the helper unmaps, or the grant expires.

Suffixes, from the same table:

| Audience | URL | Notes |
|---|---|---|
| Local / SSH `-L` of the YA port | `http://<sub>.localhost:<YA port>` | RFC 6761; no extra forward |
| Public (separate opt-in) | `https://<sub>.graehl.org` | Existing Cloudflare `*.graehl.org` else-rule already delivers TLS to 4402 |

Public is a **new option**, not implied by the local checkbox: publishing
`plan.graehl.org` is internet-reachable HTTPS to an unauthenticated
loopback app. Keep Plannotator on `127.0.0.1`; do not set
`PLANNOTATOR_REMOTE=1`. YA reverse-proxies; Cloudflare does not need a
new tunnel hostname per subdomain.

`matchesHost` must accept registered names (and unknown Hosts must still
421, never fall through to YA APIs). The helper talks to YA over the
authenticated session channel (`AGENT_YA_API_URL` / token), not by
editing Cloudflare.

A pinned-port shortcut without the helper still works for one-at-a-time
use: `PLANNOTATOR_PORT=19432` plus a static `plan` map — after the
operator (or a later `--replace` flag) has cleared the old listener.

### Public: hosted client / devices (`ya.graehl.org`)

Hosted browsers cannot use `*.localhost` — that is *their* loopback.
`ya.graehl.org` is GitHub Pages; artifact bytes already leave the relay mux
and hit `artifacts.graehl.org` (cloudflared → `127.0.0.1:4402`).

The `relay` tunnel is first-match-wins (2026-09-15):
`relay.graehl.org` → `http://localhost:4400`, then
`artifacts.graehl.org` → `http://127.0.0.1:4402`, then
`plannotator.graehl.org` → `http://127.0.0.1:4402`, then else
`*.graehl.org` → `http://127.0.0.1:4402`, then a catch-all 404.
Do not rewrite the origin Host header to `artifacts.graehl.org` — 4402
must see the public Host so YA can vhost.

**`*.artifacts.graehl.org` cannot terminate TLS on this zone today.**
The zone is Free; Universal SSL is only `graehl.org` + `*.graehl.org`.
Ordering an Advanced Certificate for `*.artifacts.graehl.org` returns
Cloudflare 1450 (Advanced Certificate Manager). Nested names would
resolve to the tunnel and then fail HTTPS. Skip that wildcard until ACM
exists.

**Landed one-level else (2026-09-15):** proxied CNAME `*.graehl.org` to
the same tunnel target as `artifacts`, plus tunnel hostname `*.graehl.org`
→ `http://127.0.0.1:4402` after the exact names. More-specific DNS still
wins (`ya` → GitHub Pages, `kyle` → kzahel Pages, `relay` / `artifacts` /
`plannotator`). `foo.graehl.org` TLS SAN is `*.graehl.org` and `/health`
returns `421 Unknown artifact host` (reached 4402). `artifacts` / `relay`
health still 200.

`plannotator.graehl.org` remains an exact published hostname to the same
port; it is now redundant with the else-rule but harmless.

Other public shape, still not built: a **path on `artifacts.graehl.org`**
(no extra DNS; needs the app to tolerate a base path).

The host's cloudflared is a dashboard-managed named tunnel (run token
only). That token cannot create DNS or hostname routes; adding a wildcard
is a Cloudflare dashboard/API change with origin-cert or API auth
([interactives](../../topics/interactives.md)). The API token needs
Tunnel write plus zone DNS write, and must allow this machine's egress
IP. YA does not install DNS or change the tunnel
([active content security](../../topics/active-content-security.md)).
R2 S3 credentials do not configure tunnels or DNS.

YA today matches artifact Hosts **exactly** (`localOrigin` /
`publicOrigin` in `ArtifactServer.matchesHost`). Dynamic names need a
grant-scoped Host table, and unknown Hosts must not fall through to YA
APIs.

### Proxy constraints

- Preserve `Host` or cookie/settings break (their UI cookie is host-scoped).
- Forward the full session (HTML, XHR/fetch APIs, relative assets). If they
  later add WebSocket, the proxy must upgrade; not verified in-tree here.
- Do not enable `PLANNOTATOR_AGENT_TERMINAL_REMOTE=1` on a public or
  cloudflared path: that lets the browser run commands on the agent host.
- A grant must be session-scoped and revoked when the review ends; a sticky
  public URL to an unauthenticated Plannotator is a hole.
- Port discovery: parse the URL Plannotator prints, or fix
  `PLANNOTATOR_PORT` in the child env and proxy that loopback port.

## Skills / briefing (still needed, smaller than the proxy)

Sessions that opt in should know: call Plannotator as usual; do not expect a
local GUI; print or return the URL; YA will open it for the user. Prototype
HTML/plans stay files Plannotator can open (`plannotator annotate
report.html`). YA does not need to re-implement their renderer.

Optional child env: `BROWSER=none` so a headless host does not spawn
xdg-open. If the vhost helper is on PATH, after Plannotator prints its
loopback URL run `ya-vhost plan <port>` (or pin `PLANNOTATOR_PORT` and
pass that). Avoid `PLANNOTATOR_REMOTE=1` unless we deliberately want
`0.0.0.0`.

## Session right pane (first YA consumer)

When the static vhost table is non-empty, YA rewrites loopback URLs in
tool output to the matching vhost origin and, if Appearance → Session
right pane is on, opens that origin in the session
[right pane](../../topics/session-right-pane.md). With the setting off,
the same URL is offered as a new-window action. `ya-vhost` remains
unimplemented; a pinned `PLANNOTATOR_PORT` plus a static row is enough.

## Remaining

Insertion point is still the artifacts port + Host dispatch, not a new
tunnel. The file-grant handler is the wrong app for live Plannotator.
Dynamic `ya-vhost` is still postponed. Public `*.graehl.org` else-rule
reaches 4402. YA still 421s unmapped Hosts.

Related: [active content security](../../topics/active-content-security.md)
(artifact origins, public listener, cloudflared-shaped tunnel, grant
transport vs byte path),
[source transport](../../topics/source-transport.md) (relay is YA REST, not
a generic proxy),
[interactives](../../topics/interactives.md) (named-tunnel run token cannot
add hostnames; reuse the existing tunnel),
[agent own-session inspection](../../topics/agent-self.md) (PATH command
directory),
[vanilla defaults](../../topics/vanilla-defaults.md),
[agent context injection](../../topics/agent-context-injection.md).

Found 2026-09-15; static Local Access vhost table landed; `ya-vhost`
postponed. Nested `*.artifacts` blocked by Universal SSL; public
else-rule `*.graehl.org` mapped to 4402.

Contributing-model: grok-4.6
