# Extension artifact viewer feasibility spike

Investigated 2026-10-16, on macOS with Playwright Chromium 148 (the separately
identified Google Chrome for Testing binary). Worktree starts at `287ce67af`.
This directory is research only: no tracked production source, manifests,
server contracts, publishing configuration, or roadmap status were changed.
No deployment, store submission, or primary-browser installation was made.

**Result: an extension-powered viewer opened a local HTML report and neighboring
PNG inside the real YA session UI, through the encrypted relay, without a public
artifact tunnel.** CSS, a webfont, classic scripts, simple module graphs, JSON
reads and linked HTML also worked through a bounded adapter. The extension
service worker did **not** intercept sandbox subresource requests. This is not
a transparent virtual origin.

## Evidence and experiment boundaries

- [Standalone browser matrix](results/probe.json): 12 cases; no-WAR, shell-only
  WAR, and all-resources WAR configurations. Every run first demonstrates that
  the extension worker answers a trusted extension page's synthetic resource
  fetch, so sandbox failures are not inferred from a nonfunctional worker.
- [Default-server full-app run](results/run-1792152944750/evidence.json): real
  local relay, real SRP/encrypted source transport, real YA app and filesystem
  APIs. Direct extension login is refused with `Forbidden: Invalid origin`.
- [Final full-app run](results/run-1792153229317/evidence.json): same viewer over
  relay, localhost direct and LAN direct. The temporary YA process adds the
  exact extension ID to its existing `ALLOWED_HOSTS` setting. Its LAN listener
  is enabled through its own `/api/network-binding` route and dies with the
  owned process. No normal YA profile is touched.
- Desktop (1000×600) and phone-width (375×812) captures were presented through
  `writeCapturePreview` / `emitCapturePreview` and inspected individually.
  Screenshots are intentionally excluded from the repository. The local chart
  renders at both widths. Existing file-viewer
  controls consume substantial space on the narrow viewport; this is a
  functional spike, not polished viewer UI. A narrow Chromium viewport is not
  native/mobile extension support.
- [Additional navigation attempt](results/navigation-attempt.json): a synthetic
  non-sandbox extension document has extension authority. Trying to replace a
  manifest-declared sandbox document's navigation response timed out. The
  latter attempt establishes no supported delivery path; the working viewer
  uses the packaged page plus messages.

All server data, provider transcript directories, browser profiles and relay
data are fresh temporary directories. The session history is a synthetic
121-message fixture, not a live paid agent session. Appended transcript updates
exercise the real watcher and UI. The requested JSTorrent example and Visualize
1.0.50 files were absent on this machine, so this tests explicit fixtures and a
small compatibility adapter, not full fidelity with those exact artifacts.

## Documented platform behavior

Chrome documents that [manifest sandbox pages](https://developer.chrome.com/docs/extensions/reference/manifest/sandbox)
have a unique origin and no extension APIs or direct access to privileged
extension pages. They communicate using `postMessage`. The sandbox CSP is
separate; it must include `sandbox` and cannot include `allow-same-origin`.
[Extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
allows inline/evaluated code in the sandbox where the privileged extension
policy cannot be relaxed that way.

[Extension worker fetch events](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/events)
cover extension package retrieval and extension-script fetch/XHR. That wording
does not establish control of an opaque sandbox's resource requests. The
experiment below is the evidence for this particular case.

[Web-accessible resources](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources)
expose packaged files to selected web origins. They do not create files at
runtime, grant filesystem access, decrypt relay traffic or authorize a fetch
bridge. The [MV3 remote-code policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
has an isolated-context exception for iframes/sandbox pages, with continuing
review and user-data obligations. This architecture fits that documented
exception in principle; store approval has not been tested or promised.

## Experimentally verified resource behavior

| Case | Result |
| --- | --- |
| Dynamically supplied self-contained HTML and inline script in packaged sandbox | Works; a real click changes the fragment |
| Sandbox authority | `self.origin` is `null`; extension API is undefined; parent DOM and localStorage throw |
| Packaged relative image, CSS, CSS import, font, classic script, module graph, JSON | Works inside the sandbox, including without WAR |
| Same resources at synthetic extension paths, answered by worker | Fail from sandbox; none of these subresource requests reaches worker |
| Synthetic JSON from trusted extension page | Worker responds successfully |
| Mark all synthetic paths web-accessible | Does not fix sandbox worker interception |
| Native sandbox HTTP fetch with permissive CSP and `Access-Control-Allow-Origin: *` | Works; server observes `Origin: null`; extension worker is bypassed |
| Same native fetch without CORS response header | Fails CORS, even with extension host permission |
| Website embeds packaged sandbox without WAR | Blocked |
| Website embeds sandbox with only shell declared WAR | Works; packaged child assets also load |
| Synthetic non-sandbox HTML document from worker | Extension origin and extension API authority; privileged CSP blocks inline script |

The packaged-resource result does not generalize to remote files: packaged
resources use Chrome's extension resource loader. Adding CORS headers to a
worker response cannot help a sandbox request that never reaches that worker.
Allowing HTTP in a sandbox CSP can permit actual network requests, but it does
not turn encrypted relay file reads into ordinary HTTP URLs.

The real viewer deliberately uses a tighter manifest CSP: native connections,
workers, frames, objects and forms are denied; images/fonts/media are limited
to data/blob URLs. Native XHR is experimentally blocked by `connect-src 'none'`.
Its expected violation is separated from unexpected browser errors. The
provided `fetch` adapter rejects `/api/version` because it is outside the
artifact directory. This is bounded byte delivery, not permission to call YA
APIs or arbitrary network URLs.

## What the working adapter does

`spike.vite.config.ts` replaces `ArtifactPreview` at build time with the
research component. The actual production component remains untouched.
`package-spike.mjs` adds the packaged sandbox and its manifest CSP only to the
research build output; production manifest assembly remains unchanged.

The trusted component binds one `MessagePort` to one viewer and its original
entry directory. It obtains file bytes through the captured source runtime's
existing raw-file API. The sandbox receives bytes, never cookies, relay keys,
resume credentials or the transport object. It creates blob URLs in its own
opaque context; no artifact-owned HTML executes in the trusted parent.

HTML uses DOMParser, CSS uses the existing pinned css-tree parser, and module
imports use the existing pinned es-module-lexer JS parser. No regex module
rewriting or new production dependencies were introduced. These parsers make
the experiment possible; they are not a production dependency decision.

| Dynamic file case | Working adapter | Qualification |
| --- | --- | --- |
| Relative PNG/image | Verified | `./assets/chart.png` |
| Absolute local image path inside admitted directory | Verified | Canonical local path, converted to sandbox blob |
| Relative stylesheet | Verified | Converted to blob |
| CSS `url()` background and webfont | Verified | Parsed and resolved relative to owning CSS/document |
| Inline styles and scripts | Verified | Sandbox policy permits them |
| External classic script | Verified | File bytes become a sandbox-local script blob |
| Static module and literal dynamic import | Verified | Small acyclic graph; imports rewritten to blobs using parser offsets |
| JSON fetch | Verified | Narrow read-only `fetch` adapter, not native network interception |
| Linked local HTML | Verified | Host replaces the sandbox document, preserving grant root |
| Widget state / follow-up | Verified | State object persists across linked-page round trip; follow-up populates composer without send |
| CSS `@import`, `srcset` | Explicitly unsupported by this adapter | Packaged fixtures support these browser mechanisms; dynamic adapter rejects them |
| Computed dynamic import, module cycles, `import.meta` | Explicitly unsupported | Blob conversion does not preserve general module URL semantics |
| Native XHR, external HTTP services, WebSockets, workers | Not provided | CSP blocks network/worker authority; no generic proxy |
| Script-created resource URLs, location-driven navigation, downloads, browser Back/history | Not established | Ordinary anchor navigation is the tested path |

Root-relative web paths do not implicitly mean the artifact directory: the
adapter interprets local references as filesystem paths. Paths outside the
entry directory are denied. This deliberately differs from hosting an
application at a web origin; it must not silently become app-server emulation.

## Identity, grants and lifecycle

The browser viewer ID identifies an instance; it is not an authenticated
principal or a file grant. The source transport authenticates the existing YA
user. The viewer port narrows that authority to read operations under one
directory, plus bounded widget-state/follow-up messages. No message accepts
an arbitrary API URL, request headers, authentication material or write action.

Verified lifecycle behavior:

- Two simultaneous viewers render independently; a self-contained fragment
  works while the main multi-file viewer remains open.
- Ordinary linked-document navigation replaces the sandbox browsing context,
  which stops old document timers. An initial document-write-only experiment
  left an old timer running; the working version uses real frame navigation
  to avoid that problem. Widget state is retained by the owning host component.
- Stop removes the iframe, closes its port, aborts owned requests and drops
  read-cache references. Navigating away also ends the old document realm.
- CDP explicitly stops the extension worker. The already-open artifact can
  still read JSON through the host's source connection, and a subsequent app
  navigation works after worker restart. Natural idle termination was not
  measured; no idle-resilience claim relies on keeping a worker alive.
- Closing/reopening or reloading the app requires a new explicit Run. No
  artifact grant, file bytes or viewer port lives in worker memory.

The prototype's file allow-set is **client-side**, layered on existing server
file authorization. It is not a production artifact grant: notably, it does
not establish server-side canonical-root/symlink confinement. Before shipping,
reuse the existing GrantStore policy behind a grant-scoped read contract,
bind the lease to source/owner/viewer generation, and enforce expiration,
revocation and realpath/symlink checks at every server read. Keep the original
grant root across linked pages. Do not widen an old capability silently.

The spike caps 32 files per document, eight in-flight reads, 8 MiB per file,
16 MiB per document and 16 KiB widget state. Byte checks currently occur after
buffering, so these are prototype bounds, not a hostile-response memory
guarantee. Production needs limits while streaming, source/viewer-wide budgets,
bounded state/page counts, cancellation and fail-closed stale-port handling.
Port ownership, not a random URL label alone, should determine who can read.

No CPU/memory containment against hostile scripts is claimed. Parking leaves
the frame live, as the existing viewer does; cooperative pausing is not a
security boundary. Close/unmount and worker restart are the measured cases.

## Measurement and verification

The final synthetic history contains 121 messages. During sequential typing,
the artifact updates every 100 ms. Composer typing also overlaps 12 appended
transcript updates and 48 observed parent DOM mutations:

| Input | Characters | Maximum acknowledgement | Dropped |
| --- | ---: | ---: | ---: |
| Artifact text input | 35 | 7 ms | 0 |
| YA session composer, artifact parked/live | 35 | 5 ms | 0 |

These are single local browser samples, not broad performance or CPU-isolation
evidence. The final run has zero unexpected page/console errors. No artifact
file is requested over browser HTTP; the intentional CSP-blocked XHR probe is
recorded separately. Relay SRP/encryption and file reads use real code, but the
relay itself runs locally. Public relay deployment, arbitrary hosted-site CSP,
incognito/third-party-cookie configurations, browser versions other than this
Chromium, Windows/Linux execution and native mobile behavior remain untested.

- Extension build, sandbox bundle and focused browser matrix: pass.
- Research TypeScript config and scoped lint: pass.
- Root `pnpm format:check`, `pnpm typecheck`, `pnpm test`: pass. The test run
  includes 6,986 client and 6,577 server assertions; these broader suites check
  the unchanged baseline, while the research browser runner is the direct
  evidence for the prototype.
- Root `pnpm lint`: fails on the unchanged
  `packages/client/src/extension/sidepanel/SidePanel.module.css:243`
  descending-specificity selector. It also reports the existing Biome schema
  version advisory. These are outside the research directory; no unrelated
  source was changed to make a feasibility spike pass.

## Interpretation and possible next slices

The extension viewer is a viable option for agent-authored HTML and local
assets. Failed worker interception does not invalidate the working bounded
adapter. Its complexity should be judged against the actual artifact support
surface, not an assumed requirement to support every web application. The
smallest useful slice can be HTML with local images, styles and fonts, then
inline/classic scripts and the small widget-state/composer bridge. The module
experiment records additional feasibility without promising arbitrary web-app
semantics.

The extension packages the isolated viewer locally and avoids a public
artifact tunnel, wildcard usercontent DNS/TLS, hosted bootstrap and content
worker registration. It still needs server-enforced file grants, resource
bounds, lifecycle ownership and compatibility gating. Direct extension
connections also need appropriate origin admission. Optional website embedding
can expose only the packaged viewer shell and use a parent-bound message
channel; no generic privileged extension fetch bridge is needed.

### Android remains an open extension of the idea

Android does not need to run the Chrome extension for this direction to be
useful. A corresponding Android viewer could receive authorized bytes through
YA's existing native transport and provide a similar bounded resource adapter.
Whether the JavaScript adapter can be shared, or Android can supply a cleaner
resource-loading mechanism, is a future platform experiment. It must preserve
isolation from YA credentials/APIs and native bridges, source-bound file grants,
concurrent-viewer identity, cancellation and teardown. No Android or iOS viewer
spike was run here; neither support nor a platform implementation is selected.

The extension and a future mobile implementation may therefore have different
host adapters while sharing file-grant semantics and the declared artifact
support surface. A single universal browser interception mechanism is not a
prerequisite for considering this approach.

The [relay content-origin proposal](../../gaps/sketches/relay-artifact-frame.md)
is another viable option, particularly for clients needing ordinary multi-file
web semantics. Its worker controls a real untrusted web origin, which the
extension sandbox did not provide. Choosing between that infrastructure, a
bounded extension/native adapter, or supporting both remains open. This result
does not reject the adapter, supersede the content-origin sketch, change
roadmap priority, or close [the HTML viewer gap](../../gaps/html-document-viewer.md).

## Reproduce

From this worktree, using the existing lockfile and no production edits:

```bash
pnpm install --offline --frozen-lockfile
ln -s ../../packages/client/node_modules research/extension-artifact-spike/node_modules
pnpm --filter @yep-anywhere/shared build
pnpm --filter @yep-anywhere/client exec vite build --config ../../research/extension-artifact-spike/spike.vite.config.ts
pnpm --filter @yep-anywhere/client exec vite build --config vite.config.extension-worker.ts
node packages/browser-extension/scripts/assemble.mjs
node research/extension-artifact-spike/package-spike.mjs
node research/extension-artifact-spike/probe.mjs
pnpm exec tsx --conditions source research/extension-artifact-spike/acceptance.mjs
pnpm exec tsx --conditions source research/extension-artifact-spike/acceptance.mjs --trust-extension
```

Skip the symlink command if it already exists. `--headed` displays the owned
test browser. `--headed --keep-open` leaves the working view for inspection
until the runner is interrupted; stop that runner afterward. Do not load the
research build into a normal profile: it retains the store extension ID.
Normal runs stop their browsers, servers and relay. Temporary profiles and
results remain on disk for examination. Nothing is published.

Contributing-model: gpt-6
