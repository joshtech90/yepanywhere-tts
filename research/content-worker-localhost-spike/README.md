# Content-origin service worker on localhost

Feasibility experiment, 2026-10-16. Isolated worktree at `9b44f3c67`, temporary
YA/relay/browser profiles, separately identified Playwright browsers. No
production runtime changes, DNS/hosts-file changes, unsafe-origin flags,
deployment or publication. Screenshots remain local and are excluded from Git.

**Yes: localhost subdomains are a useful development setup. Use nested names
that Chrome treats as the same site, for example:**

```text
Trusted host:     http://app.yep.localhost:<app-port>
Artifact origin: http://<viewer>.usercontent.yep.localhost:<content-port>
```

This extends [the existing content-origin spike](../relay-artifact-frame-spike/spike.mjs)
and [relay proposal](../../gaps/sketches/relay-artifact-frame.md). The earlier
[extension experiment](../extension-artifact-spike/README.md) used an opaque
extension sandbox whose subresources bypassed its worker. Here the artifact
runs on a separate ordinary web origin under its own worker's scope, so native
browser resource loading works without HTML/CSS/module rewriting.

## Measured Chrome results

[Raw Chromium evidence](results/chromium.json), Chromium 148 on macOS:

| Parent → content | `Sec-Fetch-Site` | Third-party cookies | Result |
| --- | --- | --- | --- |
| `localhost` → `usercontent.localhost` | cross-site | allowed | pass |
| `localhost` → `usercontent.localhost` | cross-site | blocked | worker registration refused |
| `app.yep.localhost` → `g1.usercontent.yep.localhost` | same-site | allowed | pass |
| Same nested names | same-site | blocked | pass |
| Nested names, real encrypted YA relay reads | same-site | blocked | pass |

Chrome resolved all names to loopback itself and reported secure contexts.
No TLS certificate, resolver rule, or insecure-origin override was needed.
The [Secure Contexts specification](https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy)
provides the platform background for trustworthy loopback/localhost origins;
the matrix records actual browser behavior rather than assuming every local
hostname layout has the same cookie/storage behavior.

Every successful Chrome case verifies:

- Relative PNG, `srcset`, CSS `@import`, CSS background `url()`, webfont,
  classic script, static module, **computed** dynamic import and native JSON
  fetch. The browser keeps real resource URLs under the content origin.
- Ordinary linked-document navigation and iframe reload, still controlled.
- Zero artifact `/v/` requests reaching the content host's network handler.
  That handler serves only bootstrap HTML/JS and the fixed worker; everything
  else is 404. It never has artifact files or YA authentication material.
- Parent DOM access throws and YA's sentinel localStorage value is absent
  from the artifact. The parent sets a host-only sentinel cookie; bootstrap
  requests do not carry it. Artifact policy restricts connections to its own
  origin and denies nested frames, workers, objects and forms.
- Explicit CDP worker termination followed by a successful native JSON fetch
  marked `x-ya-spike-worker: 1`. A fresh worker rediscovers the live bootstrap;
  there is no worker-resident viewer registration map to restore.
- Two concurrent viewer origins with separate localStorage. The test host
  creates a different hostname for the second viewer.
- A 4 MiB streamed resource can be cancelled after the first 64 KiB reaches
  the consumer. In the real relay sample the parent forwarded 128 KiB before
  receiving cancellation. This measures parent delivery, not encrypted bytes
  already in flight or server-side bandwidth.
- Closing the owning viewer aborts reads, closes ports, removes its iframe and
  unregisters the worker. A deliberately surviving controlled document gets
  503 on its next file read and sees zero registrations. The content network's
  fallback remains 404, so losing control does not expose file bytes.
- Outside-file requests get 403, another viewer namespace gets 503, and
  `/api/version` on the content host gets 404. No general API fetch bridge is
  exposed.

The real-relay sample acknowledges all 32 sequential artifact-input characters
with a 2 ms maximum and all 25 host-textarea characters with a 13 ms maximum,
with zero drops while the artifact updates every 80 ms. These are local
diagnostic samples, not a production YA-composer or performance-regression
benchmark.

Desktop 1000×600 and narrow 375×812 captures were presented through the
repository artifact capture helper and inspected individually. The chart,
inputs and native resource URLs work at both widths; the desktop document has
its own scroll viewport, and the narrow report fits without horizontal
overflow. Captures are not retained in the experiment record.

## What is real, and what is a stand-in

The parent UI is a small **research host shell**, not an integration into YA's
production file viewer. Local cases fetch fixture files from that trusted host.
The relay case starts an actual disposable YA server and relay, performs real
SRP/NaCl authentication using YA's `SecureConnection` and `openRelayClientSocket`,
and reads real project files through the existing streamed raw-file API. It
does not substitute a pretend encrypted transport or give the content frame
relay credentials. The relay is local, not the public deployment.

```text
Native document/image/module/fetch request
  → content-origin worker
  → bootstrap MessagePort
  → trusted host's captured YA connection
  → encrypted relay → YA file API
  → streamed bytes back to the browser response
```

The admitted files are a fixed finite fixture allow-set enforced by the host
channel. Existing YA server file authorization also applies. This is not yet
the proposed server-enforced artifact grant: general use still needs
GrantStore-backed reads, canonical-root/symlink checks, expiry/revocation,
source identity and compatibility gating. A viewer nonce identifies an
instance; it is not authentication or permission to access arbitrary files.
Same-site content remains untrusted: it must not gain credentialed YA CORS or
domain-wide authentication cookies. The bootstrap shares the artifact origin
and is not an authority boundary against that artifact; the trusted parent
must enforce the file grant, as in the existing relay proposal.

Resource bounds in the host include eight viewers, eight active readers,
64 distinct files, 8 MiB per file and a 32 MiB cumulative byte budget per viewer.
The worker uses pull-driven streams and request/body deadlines. The bootstrap
checks its exact expected parent origin; the host checks the child window,
content origin and viewer ID before transferring the port. The bootstrap's
`frame-ancestors` names only that test parent. Content worker responses supply
their own restrictive CSP and sandbox policy.

## WebKit is partial evidence

[Raw WebKit evidence](results/webkit-partial.json), Playwright WebKit 26.4 on
macOS, using its default profile:

- Registration, worker control, PNG/`srcset`, CSS import/background, font,
  classic script, static/computed dynamic modules, native JSON fetch,
  interaction, sequential typing, linked navigation and reload worked.
- WebKit reported the nested localhost embedding as **cross-site**, unlike
  Chrome. No equivalent third-party-cookie-blocked WebKit configuration was
  established by this run.
- Denied requests rejected with `TypeError: Load failed` rather than exposing
  the HTTP status observed in Chrome. A subsequent larger fetch after
  navigation/reload also failed before the cancellation check completed.
  The optional WebKit runner therefore exits nonzero. The cause is unresolved;
  cancellation, concurrent viewers and teardown were not established there.
- Explicit worker termination is a Chrome/CDP-only check in this runner.

This is useful evidence for normal resource loading in another engine, not a
claim of complete WebKit, iOS WKWebView or Android WebView support. That failing
larger-fetch path is retained as a concrete follow-up rather than hidden by a
successful Chrome result.

## Limits and next useful slice

The localhost layout is for a browser on the development machine. On a phone,
`*.localhost` refers to the phone itself. A deployed remote-web viewer needs a
real HTTPS content host; a native shell may need a platform delivery adapter.
Bundled native UI origins and WebView worker/storage policy must be tested
separately. This experiment makes no Android/iOS application changes.

Other unproven cases include true idle worker termination, public HTTPS
hosting, hostile-script CPU containment, ranges/video/downloads, absolute OS
paths in artifact resource attributes, root-relative web-app paths, backends
and WebSockets. Links/resources are expected to resolve under the admitted
`/v/<viewer>/` file tree. The fixed content host must continue failing closed
outside its static bootstrap files.

The next integration slice can mount this bootstrap in YA's existing managed
file viewer, capture that viewer's source transport and replace the fixture
allow-set with the server-enforced artifact grant. Keep content-origin
registration/lifetime owned by the viewer and preserve source/scriptless
fallback. The experiment does not select a production hosting provider or
supersede the extension adapter as another option.

## Validation

The focused Chrome/relay runner, research TypeScript check, scoped lint and
format checks pass. Root `pnpm format:check`, `pnpm typecheck` and `pnpm test`
pass; the latter includes 6,986 client and 6,577 server assertions. These broad
suites check the unchanged baseline, not browser behavior of the new worker.
The focused browser runner is the evidence for this experiment.

At the experiment revision, root `pnpm lint` failed on the inherited
`packages/client/src/extension/sidepanel/SidePanel.module.css:243`
descending-specificity error and reports the existing Biome schema advisory.
The primary checkout has concurrent edits in that component. Before production
integration, a separate cleanup commit matched the installed Biome schema and
reordered the lower-specificity rule; root lint and format now pass without
warnings. The optional WebKit runner remains nonzero for
the larger-fetch failure described above.

## Run

From this isolated worktree:

```bash
pnpm install --offline --frozen-lockfile
pnpm --filter @yep-anywhere/shared build
pnpm exec tsx --conditions source research/content-worker-localhost-spike/spike.mjs --relay
```

Add `--headed` to display the owned test browser. Add `--webkit` to include the
currently incomplete WebKit case; install its pinned browser with
`pnpm --filter @yep-anywhere/client exec playwright install webkit` if needed.
`--webkit --only-webkit` runs only that engine and does not require `--relay`.
Results, logs and presented screenshots go under ignored
`.artifacts/content-worker-spike/<timestamp>/`; only selected JSON evidence is
copied into this directory. Browsers and server/relay processes stop at the
end; temporary profiles remain available on disk for diagnosis.

Contributing-model: gpt-6
