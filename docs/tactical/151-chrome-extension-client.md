# Chrome extension client

Topic: chrome-extension-client

Status: in progress 2026-10-14, experimental. Version 0.1.1 is publicly
published; relay origin support is deployed and publicly verified.
The client spike (steps 3–5) builds, loads unpacked under the store id, reaches
the public relay and survives reloads. Steps 7–10 (shared saved hosts, exact
issue lookup, the side panel, and options with automatic lookup) are
implemented and accepted locally and in the maintainer's Chrome against a
real host (recorded under each step). Remaining step 6 checks and deferred
slices remain open. The first store approval (step 11) is complete. Independent
extension versioning, audited upload ZIPs, public listing assets and CI
tagged API submission and GitHub release receipts are implemented. Version 0.1.3 passed
[CI](https://github.com/kzahel/yepanywhere/actions/runs/38604832081) and was
submitted on 2026-10-14 with the `contextMenus` justification saved. The store
confirms **Pending review**, with automatic publication after approval.
The [live keyless authentication check](https://github.com/kzahel/yepanywhere/actions/runs/38618552980) passed on
2026-10-14 without store writes. Future tagged releases now submit through CI.
A newer verified candidate automatically supersedes an older pending or staged
submission; it confirms cancellation before uploading, and refuses an older
run that would replace a newer submission. The store runbook owns cancellation
quota and failure-recovery details.

## Objective

Serve the full YA web client from a Chrome extension, connecting to saved
hosts through the public relay exactly as the hosted client at
`yepanywhere.com` or `latest.yepanywhere.com` does. Only Chrome is in scope.

The first goal is an experiment, not a release surface: prove the remote
client runs from a `chrome-extension://` origin with login, session viewing,
typing and reload intact, then use the extension's own capabilities (side
panel, background worker, tab-aware actions) as later slices.

## Motivation

- [Trusted client packaging](../../topics/trusted-client-packaging.md) already
  lists "a Chrome-friendly local-client setup that serves pinned client files
  from a stable local or extension origin" as a candidate shape. An extension
  is the Chrome form of that idea: the code a user runs is a reviewed,
  versioned package rather than whatever a hosted origin serves today.
- Credential isolation. [Security](../../topics/security.md#authenticated-remote-access-and-the-relay)
  names "a privileged browser extension" as a client-side threat: any
  extension with all-sites access can read the hosted client's stored Remote
  Access resume secrets. Other extensions cannot inject content scripts into a
  `chrome-extension://` page, and its storage belongs to that extension alone.
  The trust root becomes the extension's publishing account instead of live
  hosted JavaScript.
- Browser integration the hosted page cannot have: a side panel beside any
  tab, a toolbar action and keyboard shortcuts, and tab-aware lookups such as
  "which YA sessions mention this GitHub PR or Jira ticket" (see
  [exact issue lookup](#8--exact-issue-lookup-on-the-server) and
  [the side panel](#9--side-panel-for-the-current-tab)).

## Current constraints

Recorded 2026-10-13 against `b16af8b22`.

- **The relay refused extension origins at the recorded baseline.** `/ws`
  and `/mux` upgrades check
  `Origin` (`packages/relay/src/index.ts:227`) against
  `DEFAULT_RELAY_ALLOWED_ORIGINS` (`yepanywhere.com`, `*.yepanywhere.com`,
  `ya.graehl.org`) or `RELAY_ALLOWED_ORIGINS`. `parseRule` accepts only
  `http`/`https` origins (`packages/relay/src/origin-policy.ts`), so a
  `chrome-extension://<id>` page gets 403 and cannot even be configured. The
  same policy drives relay HTTP CORS. The
  [origin-gating plan](000-relay-origin-and-share-gating.md#non-goals) is
  explicit that `Origin` is a browser-origin allowlist, not an identity
  signal; SRP and NaCl remain the security boundary.
- **The remote build is close to what an extension needs.**
  `vite.config.remote.ts` builds `remote.html` → `src/remote-main.tsx` with
  `VITE_IS_REMOTE_CLIENT` baked in at build time, so remote mode does not
  depend on the serving host.
- **Inline script.** `remote.html` carries an inline theme script, permitted on
  the web by a hashed CSP meta tag (`vite-plugin-csp.ts`). Manifest V3
  extension pages allow only `'self'` script sources; the script must become a
  file and the manifest owns CSP.
- **Path routing.** `remote-main.tsx` uses `BrowserRouter`, and the client reads
  `location.pathname` directly in roughly 120 places, so switching to a hash
  router is a large refactor. In-app navigation via `pushState` works on an
  extension origin, but reloading `chrome-extension://<id>/-/relay/<user>/…`
  asks Chrome for a file that does not exist.
- **Page service worker.** `public/sw.js` provides push notifications,
  network-first navigation, and streamed downloads (`src/lib/streamedDownload.ts`);
  relay artifact frames rely on a service-worker content origin. An extension
  page cannot register its own service worker; the extension has one
  background worker. `registerServiceWorker.ts` already skips registration for
  packaged origins (`isPackagedAppOrigin`: Tauri and the Android asset host).
- **Version pinning.** An installed extension stays on its packaged client
  version while servers update, as the bundled Android client already does;
  [remote hosted compatibility](../../topics/remote-hosted-compatibility.md)
  applies unchanged.

## Steps

### 1 — register the store item and pin the extension id

Completed 2026-10-13 using Machine Control in the signed-in Chrome profile.
The **Yep Anywhere** item was registered as a draft, version `0.0.1`, with
extension id
`dgeameddpnggdeenoekpiaacfghdodch`. A minimal Manifest V3 registration ZIP
requests no permissions and displays an implementation-pending page. That
seed reserved the identity before the client release. Step 11 records the
subsequent real-client submission.

The store public key is recorded in
[`identity.json`](../distribution/chrome-extension/identity.json). Its SHA-256
derives the recorded extension id. Copy its `key` into the eventual manifest
so unpacked development builds share the store identity, following
[Chrome's key instructions](https://developer.chrome.com/docs/extensions/reference/manifest/key).
The private publisher/dashboard inventory and deployment evidence belong in
the dotfiles runbook.

### 2 — let the relay accept the extension origin

Completed 2026-10-13. Exact extension origins use the validated spelling
because the standard URL parser reports `null` for this scheme. The
registered id is included in production defaults; explicit
`RELAY_ALLOWED_ORIGINS` still replaces those defaults. Local coverage includes
`/ws`, `/mux`, HTTP GET and OPTIONS, exact-id isolation, and malformed origins.
Relay suite: 136 tests passed, including 11 origin HTTP/WebSocket integration
cases (about one second for the whole relay suite). Root lint, format,
typecheck and unit suites pass. The root checks still emit the known
[tsx loader warning](../../gaps/tsx-loader-deprecation-warning.md); changing
the shared cross-platform loader is separate tooling work.

The public default relay was deployed through the private dotfiles relay-only
script from source `2d1c87eb1`; only the relay service restarted. Public TLS
health and 26 origin probes pass: registered-id admission on `/ws` and `/mux`,
GET/OPTIONS CORS, other-id/malformed/other-scheme/opaque-origin rejection, and
retained hosted-web and missing-Origin access. Private infrastructure and the
US relay availability limitation are recorded in the dotfiles runbook.
Client login and typing acceptance remains step 6 after client packaging.

- Extend the origin policy with exact `chrome-extension://<id>` rules. Accept
  only that scheme and only a well-formed id (32 characters `a`–`p`); no
  wildcards, so a configured entry names one extension.
- Add the published id to `DEFAULT_RELAY_ALLOWED_ORIGINS` and make it
  expressible through `RELAY_ALLOWED_ORIGINS`.
- Apply it to both WebSocket upgrades and HTTP CORS, as for web origins.
- Relay unit coverage for parsing, matching, and rejection of malformed or
  other-scheme origins.
- Update the [relay origin topic](../../topics/relay-origin-and-share-gating.md)
  contract, then deploy the public relay.

### 3 — build the remote client for an extension origin

- Add an extension Vite config derived from `vite.config.remote.ts`: remote
  client flag on, base `/`, no CSP meta tag, theme bootstrap as an external
  script file, output into the extension package.
- Treat `chrome-extension:` as a packaged origin in `isPackagedAppOrigin`, so
  service-worker registration and web push setup are skipped rather than
  failing.
- Keep `BrowserRouter`; reload is handled in step 5.

Spiked 2026-10-13 as `packages/client/vite.config.extension.ts`. It reuses
the remote config and adds one post-order HTML transform, ahead of the CSP
plugin, that moves each inline classic script (theme bootstrap, pre-boot
composer) into its own file at the same position, so both still run during
parse. The CSP plugin then emits `script-src 'self'` with no hashes, and the
meta policy is kept as defense in depth. The web manifest link is dropped and
`play.html` (public-share frames) is not built. The hosted remote build is
unchanged. The bundle needs no `eval` or WebAssembly: `tweetnacl` and
`tssrp6a` are plain JavaScript, so the default Manifest V3 policy suffices.

### 4 — package the extension

- New `packages/browser-extension` workspace: Manifest V3 `manifest.json` with
  the pinned `key`, a background service worker, and a toolbar action that
  focuses an existing app tab or opens one.
- Request no content scripts and no all-sites host permissions. Add a
  permission only when a step proves it necessary, and record why here.
- A build script that runs the step 3 build and assembles a loadable
  directory and a store zip.

Spiked 2026-10-13. `pnpm --filter @yep-anywhere/browser-extension
build:extension` builds into `packages/browser-extension/dist`, renames
`remote.html` to `index.html`, removes web-host files (`sw.js`, `_headers`,
the web manifest), and writes `manifest.json` with the key from
[`identity.json`](../distribution/chrome-extension/identity.json). The
version is `git describe` as four integers (`v0.9.2-814-g…` → `0.9.2.814`),
with the full description as `version_name`. The manifest requests no
permissions; `chrome.tabs.query` on the extension's own URLs works without
one, so the toolbar action focuses an existing app tab. The package has no
build script under the name `build`, so `pnpm -r build` and CI do not run
it, and root typecheck skips it as it skips the Android package. The store
ZIP is now produced by the publication build in step 11.

### 5 — make reloads and deep links work

First check whether the extension's background worker can answer navigations
to its own origin (a `fetch` handler serving the app shell for unknown paths).
If it can, that is the cleanest fallback and may also host streamed downloads
later. Otherwise, the background worker watches for failed navigations to
non-file extension paths and redirects to `index.html?route=<path>`, and the
app replaces the URL with that route before the router starts.

Verified 2026-10-13: it can. The background worker's `fetch` handler answers
same-origin navigations whose path has no file extension with
`/index.html`, and Chrome then keeps the requested URL. In Playwright's
Chromium with the unpacked build, `/`, `/login` and
`/-/relay/<user>/projects` each loaded with status 200 and routed normally;
`/` opens the host picker. The redirect fallback is not needed.

### 6 — verify against real hosts

Load the unpacked build (pinned id) with the deployed relay and confirm:

- login to a saved host through the public relay, and resume after closing and
  reopening the tab and after a browser restart;
- several saved hosts, as in the hosted client;
- session viewing and live updates;
- sequential typing in the composer at realistic transcript size, each
  keystroke visible within 100 ms (repository rule in `AGENTS.md`);
- reload on a session page and on Settings;
- desktop and narrow-window screenshots delivered through the artifact capture
  facility ([UI testing](../../topics/ui-testing.md)).

Record which features are knowingly unavailable (push, streamed downloads,
relay artifact frames) rather than letting them fail obscurely.

Progress 2026-10-13:

- From the extension origin, a relay login for a nonexistent server name
  opened `wss://relay.yepanywhere.com/ws` and received
  `{"type":"client_error","reason":"unknown_username"}`, so the deployed
  relay admits the origin end to end. No credential was used.
- The unpacked build is loaded in the maintainer's Chrome under the store id
  `dgeameddpnggdeenoekpiaacfghdodch`; the toolbar action opens the host
  picker and refocuses that tab on later clicks.
- Machine Control's browser debugger cannot attach to the extension's page
  ("Cannot access a chrome-extension:// URL of different extension"). That is
  the isolation this plan relies on, observed directly; verification of the
  logged-in client therefore uses desktop capture rather than page
  automation.
- Pending: login with a real password (the maintainer types it), resume,
  session viewing, typing latency, reload on session and Settings pages.

### Design rule for steps 7–10

The extension's value as a trusted client is that it holds YA credentials
and nothing else can reach them. Broad permissions would make it the
"privileged browser extension" that
[Security](../../topics/security.md#authenticated-remote-access-and-the-relay)
names as a client-side threat. Steps 7–10 therefore use only permissions
that show no install warning, plus narrow host access that the user grants
per site at runtime through `optional_host_permissions`. Requesting optional
permissions at runtime also avoids the store-update case where a new install
warning disables the extension until the user approves it. Debugger, all-sites
and `tabs` access stay out of this extension; Machine Control and
[remote browser diagnostics](../../topics/remote-browser-diagnostics.md)
already cover agent control of the browser.

The review-only mockup for steps 9 and 10 was
[`packages/client/mockups/extension-side-panel`](../../packages/client/mockups/extension-side-panel/README.md).

### 7 — share saved hosts across extension contexts

The side panel, the toolbar badge and automatic lookup must reach hosts
without the YA tab open. Saved hosts and resume sessions are in
`localStorage`, written synchronously by `lib/hostStorage.ts` and
`lib/rejectedResumeStorage.ts`, and the background worker has no
`localStorage`. The maintainer does not want a persistent background page or
offscreen document as a requirement.

- **No connection owner.** Each extension context (the YA tab, the side panel,
  the background worker when an event wakes it) connects on its own by
  resuming from the shared saved session. The server permits this:
  `RemoteSessionService.validateProof` checks a fresh challenge and only
  updates `lastUsed`; it never rotates the session. Several hosted tabs
  already resume one saved session concurrently.
- **Async storage adapter.** Put an adapter behind `hostStorage`,
  `rejectedResumeStorage` and the browser profile id. It loads once
  asynchronously at startup, serves synchronous reads from memory and writes
  through asynchronously, so existing callers stay synchronous.
  `chrome.storage.onChanged` updates other contexts, as the `storage` event
  does between tabs today. The web build keeps a `localStorage` adapter; the
  extension uses `chrome.storage.local` (`storage` permission, no warning).
- **One key per host.** `chrome.storage` has no transactions, so a single
  host-list value would let two contexts overwrite each other's changes.
- **`SecureConnection` needs no storage change.** It receives a saved session
  and reports new ones through `onSessionEstablished`. Its only `window` use
  is full SRP origin metadata (`SecureConnection.ts:769`), and password login
  always happens in a page.
- **A shared `openHost(hostId)` module** built from `connectSavedHost`,
  `RelayMuxSocketPool` and per-host API factories in the style of
  `createSessionApi(fetcher)`. `fetchJSON` (`api/sourceApiFetch.ts`) routes
  through the app's current source, so extension code imports factory modules
  with a host-bound fetcher and never the `api/client.ts` aggregate.
- **Active and default hosts** are extension settings stored beside the saved
  logins. Active hosts serve lookups, the badge and the attention view; the
  default host receives "new session about this page".

Constraints:

- Content scripts can read `chrome.storage.local` by default. The extension
  has none; adding one requires restricting that storage to trusted contexts
  or moving secrets to IndexedDB. Saved logins never go in
  `chrome.storage.sync`.
- No `externally_connectable` entry: web pages and other extensions cannot
  call into the extension. Opening it to another extension is a
  [principals and grants](../../topics/principals-and-grants.md) question.
- Every worker wake that needs a host pays a resume handshake, which has not
  been measured. Cache lookup results in `chrome.storage.session`. Check
  whether the server or relay limits concurrent connections per saved
  session.

A background connection owner (an offscreen document or long-lived worker
serving pages through `NativeSourceTransport` over a `chrome.runtime` port,
as the mobile bridge does) stays deferred. Nothing here precludes it.

Implemented 2026-10-13, with one deviation from the adapter design above.
`hostStorage` and `rejectedResumeStorage` rely on synchronous
`localStorage` compare-and-set under Web Locks, and every extension page
already has that `localStorage`; only the background worker lacks it. So
page storage is unchanged, and pages mirror the saved-host record into
`chrome.storage.local` (`ya.savedHosts`) after each write
(`lib/savedHostsWritten.ts`, `extension/savedHosts.ts`). The worker reads the
mirror and connects with read-only credentials: `connectSavedHost` now takes
a `SavedHostCredentials` store, and the worker's never records a session (a
resume keeps the same session id; the page's record stays authoritative).
Per-host keys were not needed for the same reason. `extension/hostLinks.ts`
is the shared on-demand connection module (`withHost`), closing a connection
after 60 s idle. Chrome hides even the extension's own tab URLs without the
`tabs` permission, so app tabs register their tab ids in
`chrome.storage.session` and the panel picks the most recently used one.

### 8 — exact issue lookup on the server

Findings carried from the original lookup idea:

- `issueUrl` (`services/issues/extract.ts`) already canonicalizes a pasted
  URL, so `…/pull/12/files` finds `…/pull/12`.
- Search remains a literal `LIKE` substring over key, title and URL
  (`IssueStore.list`): `…/pull/12` also matches `…/pull/123`, and the same
  number recorded as `issues/12` and visited as `pull/12` misses although
  their stored identity is equal.
- Jira board and backlog URLs (`…/boards/1?selectedIssue=TF-3996`) do not
  parse.
- `IssuesPage` keeps its search box in local state, so a deep link needs a
  `q`/`ref` route parameter, and its issue calls are inline rather than in an
  API module.

Add an exact identity lookup (for example `GET /api/issues?ref=<url>`),
advertised by a capability so the extension falls back to `q=` on older
servers, and parse `selectedIssue`. Extract the Issues page calls into an
`issuesClient` factory. One call returning an issue's sessions with their
live status would save the panel a second request. This changes a server
contract, so it needs the
[client/server compatibility review](../../DEVELOPMENT.md#clientserver-compatibility-review)
and maintainer approval before implementation.

Implemented 2026-10-13 without a capability bit. `GET /api/issues?ref=<url>`
matches the item whose stored identity the URL names
(`issueLookupUrl` in `@yep-anywhere/shared`, which adds Jira
`selectedIssue` to the canonical `issueUrl`, now shared with the server) and
echoes the identity as `ref`; a `ref` that names nothing matches nothing.
Clients send `q` and `ref` together and keep only `item.id === identity`
(`api/issuesClient.ts`), so an older server that ignores `ref` still gives
correct answers, missing only an item recorded under the other GitHub
`issues/`/`pull/` path. Transcript extraction is unchanged. The Issues page
keeps its inline calls; a `ref` route parameter for it remains open.

### 9 — side panel for the current tab

Permission: `sidePanel` (no warning). Lookup on click uses `activeTab` (no
warning).

- One panel per window that follows the active tab, built as its own
  lightweight entry rather than the full app at side-panel width. It reuses
  the step 7 modules and YA's status, provider and issue-type badges.
- **On an issue or PR page:** an issue header (type, key, title), then one row
  per session across active hosts with title, age, live state (activity
  subscription for the shown sessions only), provider, project and host, the
  latest agent activity, and how it mentions the issue. Below the list, "new
  session about this PR" targets the default host and a project guessed from
  the repository, and a coverage note says which sessions were indexed.
- **On any other page:** sessions that need you, running sessions and recent
  ones across active hosts, from the inbox counts `multiHostMonitor` already
  computes. This is what makes leaving the panel open worthwhile.
- **On a site without granted access:** a one-off lookup using the click, and
  the request for automatic lookup on that site.
- **Opening a session** messages the YA tab to navigate inside the app without
  a reload and focuses it, or opens a YA tab when none exists. A modifier
  click opens a new tab.
- Chrome opens a side panel only from a user gesture, so the panel opens from
  the toolbar button or a shortcut and then stays open; the extension cannot
  open it when a PR page loads.
- Verify microphone use separately: permission prompts may not appear inside a
  side panel.

Implemented 2026-10-13 as `sidepanel.html` (`extension/sidepanel/`). The
toolbar click opens the panel and records the clicked tab, whose URL
`activeTab` makes readable, in `chrome.storage.session`; the worker clears it
when that tab navigates. Rows show title, age, state (approval or question
from the host's inbox, running from session activity), provider and model,
project, host when several are active, the latest agent text and the mention
count. The panel refreshes on tab changes and every 30 s while visible rather
than subscribing to live activity. "New session about this" copies the item's
URL and opens New Session on the default host with a project whose name or
directory matches the repository; there is no composer prefill parameter yet.
The attention view shows needs-input, running and five recent sessions. A
`?url=` query on the panel page overrides the tab, for development and tests.

### 10 — options and automatic lookup

Options live in YA Settings as a **Browser extension** pane, and the
manifest's `options_page` points at that route. Values are stored in
`chrome.storage.local` so the background worker can read them.

- **Hosts:** active toggle, default host, and a connection policy per host
  ("when needed", the default, or "keep connected").
- **Issue and PR lookup:** automatic lookup on or off; per-site access
  (`github.com`, GitHub Enterprise hosts, Jira sites pre-filled from the
  hosts' learned `jira_project_sites`), each granted through Chrome's prompt
  from the toggle; an optional allowlist of repositories and Jira projects;
  whether to include dismissed associations.
- **Toolbar and side panel:** what the toolbar button does (open the side
  panel, open or focus the YA tab, or look up this page), what the badge
  counts (this page's sessions, sessions that need you, or nothing), what the
  panel shows on other pages, and whether sessions open in the existing YA
  tab or a new one.
- **Storage:** optional sync of the host list (names and relay usernames,
  never logins) through Chrome sync.

Automatic lookup listens to `tabs.onUpdated` for granted sites only; the
`tabs` permission, which warns about browsing history on all sites, is not
used. A URL is sent to a host only when it matches a repository or Jira
prefix that host has indexed, or the allowlist. Lookups wait briefly after
each URL change, since GitHub and Jira change URLs inside the page, and
results are cached per issue. The badge shows a per-tab count. When no
extension page is open, the URL change wakes the background worker, which
connects through step 7 and lets Chrome stop it when idle.

Implemented 2026-10-13 as `pages/settings/BrowserExtensionSettings.tsx`, shown
only on the extension origin; `options.html` redirects to it under the
default host. Narrower than designed: no per-host connection policy (every
context connects when needed), no attention-count badge mode and no Chrome
sync of the host list. A URL is sent to hosts when its site is granted and it
passes the allowlist; hosts' indexed repositories are not consulted first.
Per-site access is requested from the panel or the pane with `https://` and
`http://` wildcards declared as `optional_host_permissions`. Chrome's
extension details page therefore says the extension "can read and change your
data on sites", and the toolbar button's accessible label adds "Wants access
to this site", although no site is granted until the user grants one.

Acceptance 2026-10-13:

- `packages/client/scripts/extension-acceptance.mts` starts a local relay and
  an isolated server with seeded transcripts, configures Remote Access with
  the CLI, and drives the unpacked build in Playwright's Chromium under the
  store id. It passes: relay sign-in from the extension origin; the saved-host
  mirror; the panel finding exactly the two sessions for
  `tomfitag/tomfit-api#482` and not `#4821`; opening a row in the existing app
  tab without a reload; the attention view; settings typed one key at a time
  (each within 100 ms) persisting to `chrome.storage.local`; and the worker
  putting `1` on the badge of a granted PR page from the mirror alone. The
  worker bundle needed `process.env.NODE_ENV` defined, since library mode
  left React's reference in place and the worker failed at load.
- In the maintainer's Chrome (kyle@tom.fit profile, Machine Control), the
  reloaded build's side panel connected to the saved host `kylefit2` from the
  page's saved login and listed its running sessions. On
  `TomFitAG/aitrainer/pull/78`, a toolbar click looked the page up through
  `activeTab` and showed the one session that mentions it, live. Automatic
  lookup with granted site access was not exercised there.

### 11 — publish to the store

Publication preparation implemented 2026-10-13 for a public listing.
[Store preparation](../distribution/chrome-extension/README.md) owns upload
commands, independent extension versioning, assets, listing/privacy copy and
reviewer-access instructions. The original `extension-v0.1.1` workflow created
an upload ZIP and draft GitHub release for manual submission. Subsequent
release tags use a dedicated keyless GitHub/Google identity to submit the
exact accepted ZIP and record a public GitHub release with a store receipt.
Manual `package` dispatch produces artifacts; `check` on main verifies store
authentication and identity without writes. Listing/privacy edits remain in
the dashboard, and Google owns review and final publication.

The audit checks the packaged identity, manifest permissions, local/external
script entry points, absence of maps/private files, and exact icon sizes.
CI extracts and exercises the actual ZIP with its unchanged store manifest;
the automatic badge uses a separate owned-site-grant fixture. The isolated
clean profile passes session/Settings reload, saved-login browser restart and
35 sequential composer characters at a 7.9 ms maximum while real transcript
updates cross the relay, after 100 history rows. Four 1280×800 store captures
show the actual client and native side panel against public YA issues and
explicitly labeled demo sessions, with green-Y promotion assets.
The native Chrome for Testing profile and fixture services are reaped.

Local root lint, format, typecheck and unit suites pass, as do the dedicated
harness typecheck and extension acceptance. The known Node 26 tsx loader
deprecation remains in its existing tooling gap; CI uses supported Node 22.
The first hosted 0.1.0 run passed the exact ZIP checks but exposed a badge
fixture that typed in an inactive tab. The harness now activates its composer
page and waits for every frame acknowledgement with the same 100 ms limit.
The unpublished 0.1.1 candidate supersedes that failed tag. Hosted acceptance
for 0.1.1 passes in [Chrome Extension CI
38405189923](https://github.com/kzahel/yepanywhere/actions/runs/38405189923):
exact ZIP and badge fixtures pass all 35 keys, at 11.1/11.3 ms maxima, with
browser restart/resume. The workflow produced the draft release,
ZIP/checksum/source record, listing artifact and acceptance captures. Web
Store submission was authorized and completed on 2026-10-13: the exact 0.1.1
CI ZIP replaced the seed, listing/assets/privacy fields and restricted reviewer
access were saved, and distribution is public and free in all regions. The
console confirmed submission; on 2026-10-14 it reports version 0.1.1 as
**Published — public**. Automatic publication after approval remains enabled.

The maintainer selected public visibility, independent three-part extension
versions and CI upload ZIPs. Publishing a new version is the extension's
update path; until a signed-update policy exists
(open in trusted client packaging), the store account is the trust root.

## Deferred

### Other lookup entry points

- A link context menu (`contextMenus`, no warning) limited by
  `targetUrlPatterns` to issue, PR and Jira links, so a link in Slack, Gmail
  or Jira can be looked up; a selected bare key such as `TF-3996` likewise.
- PRs opened by agents link their exported transcript under "Agent session".
  Reading the PR body on click (`activeTab` plus `scripting`) could open the
  originating session directly, independent of indexing.
- An injected "YA: 3 sessions" chip on GitHub or Jira pages is rejected: it
  needs content scripts, breaks on markup changes, and exposes session titles
  to the page's own scripts.

### Other later slices

- Push notifications and streamed downloads through the extension's
  background worker; HTML artifact previews in manifest `sandbox` pages.
- Direct-mode (LAN/Tailscale, possibly plain HTTP) servers, including server
  origin checks and mixed-content behavior from an extension page.
- A narrowly scoped extension credential instead of the full Remote Access
  login. This is a new principal and needs
  [principals and grants](../../topics/principals-and-grants.md) review first.
- Address-bar keyword and global shortcuts.
- Sending the current tab (selection, link, screenshot) into a session's
  composer through `activeTab`, `scripting` and `contextMenus`.
- Left out of steps 9–10: a per-host "keep connected" policy, an
  attention-count badge (needs a periodic wake or push), Chrome sync of the
  host list, live activity subscriptions in the panel, a composer prefill
  for "new session about this", Jira sites suggested from the hosts' learned
  projects, and a `ref` route parameter for the Issues page.

## Topic ownership on landing

The Chrome-extension shape and its observable contract (supported features,
known unavailable ones, update path) belong in
[trusted client packaging](../../topics/trusted-client-packaging.md); the
extension origin rule belongs in the
[relay origin topic](../../topics/relay-origin-and-share-gating.md).
