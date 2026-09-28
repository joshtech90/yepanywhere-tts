# Project templates — sketches

Designs that are not current guidance: the superseded prompt-first proposal,
and the stacks and reach paths weighed for the first canvas template and set
aside. [[project-templates]] owns the current config-driven contract. This
file keeps the reasoning so a rejected option is not re-argued from scratch.
Dates are when an option was weighed, not when it might be revisited.

## Prompt-first design (September 19–20, superseded)

This section records the September 19–20 proposal and its broader reach
requirements. Its template anatomy, source locations, `canvas-ts` name,
prompt-first assembly, staged first turn and phase order are superseded by the
[current contract](project-templates.md#current-contract--config-driven-templates).
Its runtime and pane ideas remain proposals and describe no delivered template
functionality.

### The idea in brief

Today "new project" in YA means pointing it at a directory that already
exists. Everything after that — layout, conventions, tooling, whether there is
a web app and how to run it — is improvised by the agent in the first session
and re-improvised in the next project. A **project template** fixes that
first minute: a small, curated starting tree, a project `AGENTS.md` that
explains the layout to whatever agent opens it, and a one-time **boot
prompt** the agent acts on immediately. YA creates the directory, runs
`git init`, registers the project, and opens the first session already
holding that prompt plus whatever the user typed.

Worked example: from the Projects page the user types
`/start-project canvas-ts a breakout clone with a ball that speeds up`.
YA creates `~/projects/breakout/` from the `canvas-ts` template (TypeScript
over HTML5 canvas, no server), commits it, and opens a session whose first
turn is the template's boot prompt followed by the user's request. The agent
reads the project `AGENTS.md`, builds the game, and the result is reachable
in YA's App pane on the name reserved for the project. Later the user says
"add a server to keep high scores"; the project `AGENTS.md` already points
the agent at the `server` element, so the project ends up shaped the same as
if `server` had been picked at creation.

Two libraries feed the chooser: a **shipped** set of defaults, kept in a
separate contributable repository so YA's own source stays small, and a
per-user `~/ya-templates` git repository for customized or private
templates. The design is deliberately prompt-first: templates and their
composable **elements** are markdown documents an agent applies, and scripts
only accelerate the mechanical parts. There is no template configuration
language.

Facts this proposal rests on, checked against the tree at `a34d5c7bb`:

- YA has no template concept. `POST /api/projects` (`routes/projects.ts`)
  only registers an *existing* directory; there is no mkdir and no `git init`
  for local projects.
- Apps are global Settings → Apps vhost rows `{name, port, public?}`, not
  project-linked ([[active-content-security]] § Interactive HTML artifacts).
  `name.localhost` and `name.<public root>` reverse-proxy HTTP to a loopback
  port; WebSocket upgrades answer 501; streaming responses pass through.
- Static, serverless delivery exists only through artifact grants
  (`ArtifactServer` `/a/:token/*`), with a fixed CSP.
- The data dir (`getDataDir`, `config.ts`) is opaque app data; nothing in it
  is git-controlled.
- `/` redirects to `/projects`; no command input exists outside the session
  composer ([[bang-commands]], [[emulated-slash-commands]] are composer-only).

Relation to [[interactives]]: that proposal owns *reach and runtime* for a
project-affiliated app (icon links, isolated origin, lifecycle) and its
architectural review (`interactives-architectural-review.md`) bounds what YA
may host. This topic owns *project birth*: what a template is, where the
library lives, and how a new project is created from one. A template may
produce an interactive, but templates never require YA to become an app host;
every reach path below is an existing mechanism or a clearly separate later
phase.

### Motivation

Reproducibility is the first win: the tree, the project `AGENTS.md`, and the
first prompt are curated once and reused, and a user can save a project shape
they like back into a private library. The second win is the novice case
from [[interactives]] (tap, describe the game, play it): that only works when
the agent starts from a tree it already knows how to extend, rather than
inventing a build setup under a child's first request. The third is
contribution: because a template is a directory of markdown and starter
files, anyone can propose a new default by pull request without reading YA's
source.

### Vocabulary

- **project template** — a directory in a template library: `template.json`
  metadata, a `files/` tree copied verbatim into the new project (including
  the project's `AGENTS.md`), and `BOOT.md`, the one-time boot prompt.
- **template library** — an ordered set of template directories. Two
  sources: **shipped** (in the YA install) and **user** (`~/ya-templates`).
  The UI shows their union; a user template shadows a shipped one of the same
  name.
- **boot prompt** — `BOOT.md`, sent as the first user turn of the project's
  first session so the chosen model acts on the fresh tree immediately. Sent
  once; never re-injected.
- **first-turn request** — optional user text appended after the boot
  prompt in that same first turn.
- **shape elements** — named, composable features a project has or can
  acquire: *interaction* (`batch` stdin/stdout, `chat-turn`, `canvas`),
  *ui runtime* (`none`, `ts` — TypeScript over HTML5 canvas/SVG/DOM, the
  default — or `wasm`), *graphics* (`nanovg`, optional, over `ts` or
  `wasm`), *state* (`client` browser storage, `server` loopback process on
  the YA host). Each element is a shipped **prompt document**, not config:
  the base template's `AGENTS.md` tells the agent how to apply one later, so
  "add a server" or "add graphics" in a later turn converges on the same
  tree as choosing it at creation. Applied element text is inline-copied into
  the project for portability, never resolved at runtime from YA.
- **accelerator** — an optional script an element may ship that performs
  its mechanical part (copy files, add deps) at instantiation; a bypass of
  the prompt path for speed, never the definition of the element.
- **template bundle** — the single-pasteable text form of a template, for
  import/export.

### Template anatomy

```text
<library>/<name>/
  template.json     # name, title, description, elements, requires, version
  BOOT.md           # one-time boot prompt (markdown)
  files/            # copied into the new project root
    AGENTS.md       # project layout + the inline-copied element conventions
    README.md
    ...
```

`template.json` (minimal v1):

```jsonc
{
  "name": "canvas-ts",                    // slug; unique within a library
  "title": "2D canvas game (TypeScript)",
  "description": "HTML5 canvas drawing in TypeScript, no server",
  "elements": ["canvas", "ts", "client"], // applied at creation, in order
  "requires": ["node", "pnpm"],           // executables the boot prompt assumes
  "app": { "kind": "static", "dir": "web" } // optional: how to reach the result
}
```

#### Common build and run contract

Every template, whatever its stack, leaves the project with the same
affordances so that YA, the agent, and the reach paths below never need
stack-specific knowledge (decided 2026-09-20):

- **`build`** produces a serveable client bundle in a fixed directory
  (`dist/` by convention, named in `template.json` `app.dir`). The bundle
  must be openable as plain static files: relative asset URLs, no
  server-side routing assumed, so it works from an artifact grant, from a
  vhost row in front of any static server, and from a `file://` URL for a
  quick look. A template with no client (`batch`) still defines `build` and
  leaves the directory empty or absent.
- **`start`**, present only when the project has a `server` element, starts
  the loopback server on the port given by the environment (the vhost row's
  exported name, else a `PORT` default), serving the built bundle itself
  and its own API. `dev` may additionally offer hot reload; `start` is the
  one YA and the boot prompt rely on.

- **`publish`**, optional, present only when `start` is absent: copies the
  built bundle into a project-named subdirectory of a configured GitHub Pages
  checkout and pushes it, so `https://<pages-host>/<name>/` serves the game
  with the operator's existing credential and checkout. Copy without deleting,
  so previous hashed assets survive the CDN's ten-minute HTML cache, and add a
  `404.html` copy of the entry only if the app needs it. A per-project
  repository or custom domain is a later option.

  Pages is static hosting without response headers, which the contract
  already tolerates: no COOP/COEP (so no `SharedArrayBuffer` or wasm threads,
  matching the artifact path; `coi-serviceworker` can fake it if ever
  needed), no CSP or `Cache-Control` control, no server for an API, public
  by default (private Pages needs GitHub Enterprise, so the boot prompt says
  a publish is world-readable), and quotas of roughly 1 GB per repository,
  100 MB per file, and ten builds an hour, which only large committed media
  would strain. In return it is https with a valid certificate, so the mic
  works and the App pane can iframe it, and there is nothing to run. The
  bundle's relative asset URLs mean the subdirectory base path costs nothing.

For the Node templates these are ordinary `package.json` scripts. A wasm or
engine template maps the same names onto its toolchain through a small
`Makefile` or script so the names hold.

Every template also ships `README.md` as `# <name>` followed by one HTML
comment asking for one or two sentences about the project. YA's
[[project-captions]] derivation skips comments and short headings, so a
fresh project shows no placeholder caption; the boot prompt and project
`AGENTS.md` tell the agent to replace the comment in its first turn, after
which the caption appears on Projects without any YA-side registration. The
project `AGENTS.md` names the commands above and nothing else about running
the app; `template.json` `app` records the
directory and whether `start` exists, which is what the create flow reads to
pick a reach path and what the App pane reads to know what to show.

#### Prompt-based element layer

Elements live beside the shipped templates as prompt documents:

```text
<library>/                   # shipped snapshot or ~/ya-templates
  elements/<element>.md      # what the element is, the layout it adds,
                             # conventions the project AGENTS.md must carry
  elements/<element>/accelerate.sh   # optional mechanical accelerator
  <template>/...             # a template = base + a list of elements
```

A template is therefore mostly a *choice of elements* plus a boot prompt. At
creation, YA copies `files/`, then either runs each listed element's
accelerator or leaves the element text in the boot prompt for the agent to
apply, and in both cases appends the element's convention section to the
project `AGENTS.md`. The base `AGENTS.md` shipped in every template says how
to apply a not-yet-present element on request ("add a server", "add
graphics"), naming the same element documents, so the lazy path and the
creation path produce the same project shape. The user library may add
elements the same way (`~/ya-templates/elements/`). The mapping from
user-facing options to resulting state is thus owned by prompt text shipped
with YA, and scripts only shortcut it; there is no template config language
beyond the element list.

`requires` is advisory: toolchain availability is an operator responsibility
([[interactives]] § App template), so YA lists missing executables in the
chooser rather than provisioning them. `app` tells the create flow which reach
path (below) applies once the agent has built something.

**Template bundle format.** One markdown document: a `template.json` fenced
block, a `BOOT.md` fenced block, then one fenced block per file headed
`### file: <relative path>`. Text files only in v1; binary assets are out of
scope (the boot prompt can fetch or generate them). Export produces this
document; import parses it or clones a git URL whose root, or a named subdir,
has the template layout. Import lands in the user library only.

### Library locations

- **Shipped:** a separate GitHub repository — favored (2026-09-19):
  `graehl/yep-project-templates`, not yet created — holding the default
  templates and element
  documents, so YA's own repository carries no template content and a
  newcomer can contribute a default template through an ordinary pull
  request there without touching YA source. YA takes a snapshot of that repo
  at a pinned ref into `{dataDir}/templates/shipped/` on first use or on an
  explicit "update shipped templates" action, and reads the list from there
  so hosted and relay clients see the same set and nothing enters the client
  bundle ([DEVELOPMENT.md](../DEVELOPMENT.md) § Minimalist Runtime). The
  snapshot is opaque app data like the rest of the data dir: not a git
  checkout, not rewindable, replaced wholesale on update. The pinned ref and
  a minimal built-in fallback set (enough to work offline) live in YA source.
- **User:** `~/ya-templates`, overridable by `YEP_TEMPLATES_DIR`, is the
  only git-controlled part. Created lazily on the first user action that
  needs it (save, import, or "open templates dir"), as an empty git
  repository with an initial commit of a `README.md` naming the layout.
  Listing never creates it. This is a YA write outside the data dir and
  outside any project, so it is explicit-action only and reported in the UI;
  it is not governed by [[project-directory-storage]] because it is not
  inside a selected project, but the same posture applies: YA writes there
  only on a named user action. A user edits or customizes a shipped template
  by copying it into this library, where it shadows the shipped name.
- The data dir stays non-versioned. Rewind and history belong to the user
  library alone.

Listing endpoint (proposed): `GET /api/project-templates` returning the union
with `source: "shipped" | "user"` and `shadows` when a user template hides a
shipped name. Gated by a new server capability so old servers show no template
affordances ([[server-capabilities]]).

### Creating a project from a template

Inputs: template, parent directory, project name (directory basename),
optional first-turn request, provider/model for the first session.

1. Refuse an existing target directory; create `<parent>/<name>`.
2. Copy `files/` verbatim. No token substitution in v1; the boot prompt tells
   the agent to rename placeholders it finds. (Substitution is a later
   element, not a v1 config language.)
3. `git init`, stage everything, one initial commit naming the template and
   version. This is the only Git write YA performs; afterwards the project is
   an ordinary selected project and [[project-directory-storage]] applies in
   full — no `.yep/`, no excludes.
4. Register via the existing add-project path.
5. Open a new session in the project and send `BOOT.md` (+ first-turn
   request) as the first user turn. Under [[vanilla-defaults]] the composed
   turn is shown in the composer for the user to send, not auto-sent, unless
   the user chose "start immediately" in the chooser.

Failure at any step leaves nothing registered; a partially created directory
is reported with its path, not silently deleted.

**Entry points:**

- **New Project** — chooser dialog reachable from the Projects page's
  existing add-project form (a "from template" mode beside "existing
  directory"). Whether it also gets its own sidebar row is an open decision;
  the least-disturbing default is the form mode plus the landing command
  field, with a sidebar row as an Appearance option ([[vanilla-defaults]],
  [[session-ui-customization]]).
- **`/start-project [template] [first-turn-request]`** — an emulated
  composer command ([[emulated-slash-commands]]) that opens the chooser
  prefilled; with both arguments and a configured default parent directory it
  goes straight to creation. It is also the command the landing field accepts.
- **Project Templates** — library management: list with source and shadowing,
  open template dir, import from URL or pasted bundle, export bundle, "save
  current project as template" (copies the tree minus `.git` and ignored
  files, prompts for `BOOT.md`). Proposed home: Settings → Project Templates,
  with an optional sidebar row.

**Projects landing command field.** `/` keeps redirecting to `/projects`. The
Projects page gains a single-line command field at the top that accepts
`/start-project …` and the other emulated commands that make sense without a
session, plus a link to Project Templates. Default focus applies only on
pointer-fine (desktop) viewports; on touch devices auto-focus raises the
keyboard over the list, so the field is present but unfocused. The field
must keep the keystroke guarantee in [AGENTS.md](../AGENTS.md) (every
keystroke visible within 100 ms) independent of the project list loading.

### Reach: what each shape can use today

| shape | delivery today | limits |
|---|---|---|
| `batch` (stdin/stdout) | none needed; the agent runs it via tools / `!!` | — |
| `chat-turn`, `state: client` | static bundle via artifact grant | fixed CSP below |
| `canvas` `ts`/`wasm`, `state: client` | static bundle via artifact grant | fixed CSP below |
| any shape, `state: server` | vhost row → `name.localhost`, `name.<public root>` | HTTP + SSE only; no WebSocket (501, [gap](../gaps/vhost-websocket-forwarding.md)); row is global operator config |

**Wasm confirmed deliverable** on both paths. On the artifact path,
`getMimeType` maps `.wasm` to `application/wasm`, and `ARTIFACT_CSP` carries
`'unsafe-eval'`, which permits `WebAssembly.instantiate`. Two artifact-path
limits matter for templates: `worker-src 'none'` blocks Web Workers, and no
COOP/COEP headers are sent, so `SharedArrayBuffer` and wasm threads are
unavailable. Single-threaded wasm drawing to a WebGL canvas is fine; a
threaded build is not. On the vhost path the proxy forwards upstream headers
(overwriting only `Cache-Control` and `Referrer-Policy`), so a project server
can set its own COOP/COEP and MIME.

The default `canvas` runtime is `ts`: TypeScript over the browser's own
HTML5 canvas, SVG, and DOM, built with the project's bundler, no graphics
library. Agents should not be left with untyped JS tooling, so no shipped
template targets plain JS. The `graphics` element (nanovg) is opt-in on top:
nanovg-zig (zlib license) builds with `zig build -Dtarget=wasm32-freestanding`
and renders through WebGL from a small TypeScript glue file, so `ts` +
`wasm` + `graphics` is still a static bundle (`index.html`, glue, `.wasm`);
nanovg-js is the no-Zig form of the same element.

**App name reservation.** Settings → Apps already lets an operator map a
name to a loopback port, reachable as `name.localhost` and, with a public
root configured, as `name.example.com` through the operator's own tunnel.
Every templated project reserves such a row at creation, whether or not its
template declares an `app` (decided 2026-09-19): a project with no
interactive does not need a subdomain, but owning one by default costs
nothing and lets a later "add a server" land on a name that is already its
own. The reserved name
defaults to the project's short code name ([[project-code-names]]), which
already differs from the directory path and is itself editable, and the
reservation may be edited to differ from both; the row is written to
Settings → Apps like any other, with
a `project` field naming the project it was reserved for, and the port left
to be filled when the agent picks one (the boot prompt tells it the reserved
name and to report the port). Reservations stay ordinary rows: the operator
can delete one or reassign it to a different project from Apps settings, and
no project-side file records it, so [[project-directory-storage]] is
untouched. Names must be collision-free; on collision the chooser blocks
until the user picks one of: choose another name, remove the old row, or
auto-rename the old row (`<old>-1`, next free suffix), which also updates
that row's project reference. Rows are still global operator config, not a
project-declared registry; that stronger form is phase 4 and must keep the
[[interactives]] posture: loopback-only targets, app-scoped bearer by
default, no YA API on that origin.

**Chat-turn view without the provider.** Some projects *are* a chat: a text
adventure, a simulated support agent, a tutor. A `chat-turn` template ships
a small turn-view TypeScript library, inline-copied into the project, that renders
session-like user/assistant turns from the project's own code (client-only
via browser storage, or from a loopback server over HTTP + SSE). It is
project code served by the project, not a YA route, and is not a YA
transcript; YA's session UI is uninvolved. Extracting that library from
YA's client is a later refactor question, not a v1 dependency.

### Stack decision

Decided 2026-09-20 for the kid-facing canvas template. The envelope: 2D/3D
drawing, microphone input, the YA App pane ([[session-right-pane]]) as the
primary testing surface from a tablet over relay, agent-primary editing
(the kid points at the pane and describes the change; the agent edits), and
iOS/Android packaging only at the very end. Two axes decide: how well an
agent reads, writes, and verifies the project from text, and how well the
result runs inside an iframe. Human-facing editors and toolchains count for
nothing under agent-primary, and an emulator cannot render into the pane, so
every candidate reduces to its web target.

- **`canvas-ts` is Vite + TypeScript + Canvas2D**, built by plain
  `npm create vite`, dev server on a loopback port behind a vhost row, hot
  reload straight into the pane. `getUserMedia` plus `AudioWorklet` for the
  mic, behind a "tap to start" screen, which the user-gesture requirement
  forces and which is also good game design. The base tree also carries the
  in-page console forwarder (next section) and a PWA manifest, which gives
  "Add to Home Screen" on iPad without any packaging step. A project
  `AGENTS.md` of about twenty lines suffices.
- **Elements over that base:** `webgl` (WebGL2 through a thin library, or
  three.js for 3D), `graphics` (nanovg over wasm/WebGL, optional and
  expected to go unused), `mobile-shell` (Capacitor; needs a desktop with
  Xcode/Android Studio and matters only at packaging), `server`.
- **Godot 4** survives only as a possible later template on the vhost path
  for an explicit engine-learning goal. Expo, Flutter, and standalone p5.js
  are out. The reasoning for each set-aside option is in § Stacks considered
  for the kid-facing canvas template below.

Two constraints that hold whatever the stack:

- **iOS Safari is the real limit.** No WebGPU on older iPads, audio input
  only after a gesture, and `AudioWorklet` inside a web view has broken
  across versions. Test the mic on the actual device before promising it.
- **The pane iframe must grant the permissions the app needs.** `getUserMedia`
  inside an iframe fails unless the embedding frame sets
  `allow="microphone"` (likewise `camera`, `gamepad`, and `fullscreen` if a
  later full-screen toggle uses the Fullscreen API rather than a YA layout
  change), and the page must be a secure context, which localhost and the
  https hosted client both are. This is a requirement on
  [[session-right-pane]], not on templates.

### Runtime observability: where the agent sees the app's console

The earlier draft omitted a requirement every template with a UI must meet:
the boot prompt and the project `AGENTS.md` must tell the agent **where to
see the running app's `window.onerror`, unhandled rejections, and
`console.log` output**, and how to get some subset of it into its own
context without the user relaying screenshots. The agent can effectively
`tail -f | grep` such a stream, drive the page under Playwright, or rely on
a client-side forwarder that ships browser console and error events onward;
the template must pick one and name it so the first session does not
improvise it.

Candidate mechanisms, per stack:

- **vite-plugin-terminal** — a Vite plugin that forwards browser
  `console.*` to the Vite dev-server terminal, so the agent reads the same
  process output it started; the simplest fit for the Vite templates.
- **chii** (remote DevTools) — a hosted DevTools frontend attached to the
  page by a script tag; useful for a tablet whose own DevTools are
  unreachable, but its output is a browser UI, not text the agent reads
  directly.
- **chrome-devtools-mcp** — exposes a Chrome DevTools session to the agent
  over MCP (console, network, screenshots); works when the agent's harness
  can load an MCP server and the page runs in a Chrome the agent controls,
  which excludes the kid's iPad.
- **Playwright** — the project can ship a tiny script that opens the dev URL
  headless, subscribes to `console` and `pageerror`, and prints them; this
  is the stack-independent fallback and doubles as a smoke test.
- **A small in-page forwarder** — a few lines that `POST` console and error
  events to the project's loopback server (or the Vite dev server via a
  middleware), which appends them to a file the agent tails. This is the
  only option that captures what happened on the *tablet*, since every
  other mechanism observes a browser the agent itself launched.

The template's `AGENTS.md` should state which of these is wired, the exact
command or file to watch, and an optional filter (a prefix or level) whose
matching lines are worth pasting into a session.

**Pane channel (decided 2026-09-20).** Because the app runs inside YA's own
client, the forwarder needs no server of its own: the base tree ships a few
lines that `postMessage` console and error events to the parent frame, and
the App pane collects them. That gives the agent the console from whatever
device the kid is holding, including an iPad with no dev tools, with no
Playwright. The same channel carries the reverse direction for
comment-on-asset: tap or click a spot in the pane, and YA asks the app what
is at that point, attaches the answer with a screenshot crop and the recent
console tail, and lands it as the next turn. Plannotator-style annotation is
the prior art. The template ships the in-page half with a stable message
shape; YA owns the pane half, including the origin check, and offers "send
recent errors to session" or attaches them to the next turn. That pane half
belongs to [[session-right-pane]] and [[interactives]] phase 4, not to the
template repository. Direct-edit tooling stays out of scope: the agent
already edits files, and a live-tweak surface for numbers is an element the
agent adds when asked.

### Reaching the pane from a tablet over relay

The encrypted relay carries only YA protocol. Grant management rides it, but
artifact documents and vhost apps travel directly from the browser to the
artifact origin, which must be reachable on its own
([[active-content-security]] § Configuration and delivery). Serving the
hosted client over https therefore says nothing about whether the pane can
load the app.

**Chosen path: a public wildcard to the artifact listener.** This is what
the design already assumes: the operator tunnels `*.<root>` to the artifact
port with Host preserved. With a wildcard DNS record such as
`*.example.com` in place, what remains is one catch-all ingress rule on the
operator's tunnel to the artifact listener, ordered after any specific
hostnames it already serves, and `example.com` as the public root in
Settings → Apps. After that `breakout.example.com` works from any device with
no client software, vhosts stay behind the app-scoped bearer, and static
bundles use the artifact origin the same way. Reserved app names must then
also avoid the hostnames already in use on that root (for example a relay or
hosted-client name), which the reservation collision check should cover.

The wildcard is per YA server deployment: each operator brings their own
DNS record and tunnel, and the relay is uninvolved. Name reservation is
likewise local to that server's Apps rows; there is no public or shared
name registry. A deployment without a public root has no vhost reach from a
remote tablet, so a template must still work when only artifact-grant static
delivery is available, and the chooser should say which reach paths the
current server offers. Tailscale,
an SSH tunnel from the tablet, and emulators were weighed and set aside; see
§ Reach paths from a tablet over relay below.

### Phases

0. **Proving-out: one template, no library UI.** The first implementation
   ships exactly one template, `canvas-ts`, compiled into YA source, and
   one input: a project name. No chooser, no Project Templates page, no
   user library, no import/export, no element selection. The create flow
   (mkdir, copy, `git init`, register, boot session, app-name reservation)
   and the build/run contract are exercised end to end, the App pane shows
   the built bundle, and the console forwarder is proven against a real
   tablet. Entry is `/start-project <name> [first-turn request]` from the
   composer or the landing field, or the "from template" mode with the
   template fixed. Everything in the phases below is conditional on this
   phase demonstrating that the first session actually produces a playable
   result from a description. ‖
1. **Library and listing.** Shipped-templates repo with pinned snapshot
   into the data dir and built-in fallback, `~/ya-templates` lazy git init,
   `template.json` + `BOOT.md` + `files/` layout, union listing endpoint and
   capability, read-only Project Templates page. No creation yet. ‖
2. **Create from template.** mkdir + copy + `git init` + register + boot
   session; app-name reservation as an Apps row with collision handling;
   New Project chooser mode on the Projects page; `/start-project`;
   landing command field and Templates link. ‖
3. **Element layer and shipped set.** Element prompt documents with
   optional accelerators, base `AGENTS.md` lazy-apply instructions; shipped
   templates: `canvas-ts` (the one real template, per § Stack decision),
   `batch`, and `chat-turn` (client state); `webgl`, `graphics`,
   `mobile-shell`, and `server` as add-on elements (a `chat-turn` +
   `server` project replaces the earlier `chat-turn-server` template, and
   `canvas-ts` + `graphics` the earlier `canvas-wasm-zig`). Bundle
   export/import and URL import; save-project-as-template. ‖
4. **Project-linked reach.** Project-declared vhost row / subdomain and the
   turn-view library's relation to YA's client; any managed lifecycle. This
   phase is where [[interactives]] and its architectural review govern.

### Open decisions

- Sidebar rows for New Project and Project Templates: separate toplevel rows,
  Settings only, or Appearance-gated rows.
- Default parent directory for created projects (a setting, or ask each
  time).
- Whether `BOOT.md` is sent automatically or only staged in the composer; the
  proposal defaults to staged, with an explicit "start immediately" choice.
- Bundle format details: header syntax, size limits, binary files.
- Whether the user library may also be a subdir of an existing user git repo
  rather than its own repository.
- Reservation rows: whether a later code-name edit offers to rename the
  reservation, whether a portless reserved row is a new row state or
  just a row with port `0`, and what Apps settings shows for the project
  field when the project is later hidden or deleted.
- Shipped-repo mechanics: whether `graehl/yep-project-templates` stays the
  home or moves under kzahel once upstream adopts the feature, snapshot
  transport (tarball fetch versus `git archive`), how the pinned ref is
  advanced with YA releases, and how small the built-in fallback set is.
- Element conventions' exact text, which pairs compose (e.g. `canvas` +
  `chat-turn` overlay), and when an accelerator is worth shipping versus
  leaving the element prompt-only.
- Whether "add element" later is also exposed as a composer command
  (`/add-element server`) or stays a plain natural-language request the base
  `AGENTS.md` already handles.
- Whether artifact-path CSP should gain `worker-src 'self'` and COOP/COEP for
  static bundles; that is an [[active-content-security]] decision, recorded
  here only as the template-side need.
- The pane channel's message shape and origin check, and whether the pane
  attaches recent console/errors to the next turn automatically, on a
  per-project setting, or only on an explicit "send to session" action.
- Which `allow` permissions the App pane iframe grants by default
  (microphone, camera, gamepad, fullscreen) and whether that is a per-app
  row setting.
- Unverified beliefs to check on the actual tablet before the SSH-tunnel
  path in the sketches is offered to anyone: Android Chrome resolving
  `*.localhost` without DNS, and exempting `localhost` origins from
  mixed-content blocking inside the https hosted client.

## Stacks considered for the kid-facing canvas template (2026-09-20)

The envelope: 2D/3D drawing, microphone input, iterate from a tablet with
the YA App pane as the primary testing surface, agent-primary editing, and
eventual iOS/Android packaging. Under that envelope every candidate reduces
to "what does its web target look like inside an iframe", and the deciding
axes are how well an agent reads, writes, and verifies the project from text
and how well the result runs in the pane.

- **Vite + TypeScript + Capacitor.** Same base as the chosen template;
  Capacitor wraps the bundle for iOS/Android, with Xcode/Android Studio only
  at packaging. Set aside as *base tree* content because the pane never
  exercises it and a PWA manifest already gives "Add to Home Screen" on iPad.
  Kept as the `mobile-shell` element. iOS WebView audio input needs a user
  gesture and has had permission quirks across Safari versions; verify on the
  actual iPad when the element is first used.
- **Godot 4 (GDScript).** Most opinionated and best for a kid who will open
  an editor: scene tree, physics, tilemaps, particles, audio, input mapping;
  exports to web (wasm), iOS, Android. Mic is `AudioStreamMicrophone` with
  `AudioEffectCapture` and `audio/driver/enable_input` on; C#/.NET still
  cannot export to web. Rejected for v1 because the editor is its whole
  advantage and the pane shows only the export: a 30–40 MB wasm bundle with
  multi-second reload, whose default threaded build needs `SharedArrayBuffer`
  (COOP/COEP, which the artifact path does not send), and whose
  thread-support-off export is its least-tested mode inside a
  `worker-src 'none'` CSP. GDScript also has far thinner agent coverage than
  TypeScript, and headless export needs version-matched export templates.
  Survives only as a possible later template on the vhost path for an
  explicit engine-learning goal.
- **nanovg (zig or JS build, over wasm/WebGL).** Vector antialiased 2D with
  a canvas-like API, portable to non-browser targets. In the pane it
  re-implements Canvas2D, which the browser already accelerates, at the cost
  of a Zig or Emscripten toolchain, a glue layer, font loading into the wasm
  heap, and a thin corpus for the agent. Its real win, one 2D API in browser
  and native, is not a stated goal; if it becomes one, Canvas2D in the browser
  plus a Skia binding natively is the pragmatic form. Kept as the optional
  `graphics` element and expected to go unused.
- **Expo (React Native) and Flutter.** UI-widget frameworks whose canvas
  story is a bolt-on (`@shopify/react-native-skia`, `CustomPainter`) and
  whose web targets are their least polished part. In a pane-only loop an
  emulator cannot render into the browser, so they reduce to those web
  builds. Rejected.
- **p5.js (`sketch.js`).** Designed for beginners (`setup`/`draw`), good for
  the first afternoon, but untyped and global-namespace, and slow past a few
  hundred objects. Its TypeScript-friendly instance mode fits inside the
  Vite base as a library if wanted; not a template of its own.

## Reach paths from a tablet over relay (2026-09-20)

The encrypted relay carries YA protocol only; pane content travels directly
from the browser to the artifact origin
([[active-content-security]] § Configuration and delivery). Options weighed:

- **Public wildcard tunnel to the artifact listener** — chosen; see
  § Reaching the pane from a tablet over relay above. One wildcard DNS record
  and one ingress rule on the operator's existing tunnel; no client software; vhosts stay behind the app-scoped
  bearer.
- **Tailscale/WireGuard on the tablet.** Persistent and not killed by
  Android, but it works best by skipping the relay: open the local client at
  the tailnet address. The https hosted client cannot iframe an http tailnet
  origin (mixed content), and `tailscale serve` gives one TLS hostname
  without wildcard subdomains, so vhost-by-label does not fit. A fine
  operator path, not a kid's default.
- **SSH tunnel from the tablet** (Termux, ConnectBot, JuiceSSH). Forwarding
  YA's port alone covers client, artifacts, and `name.localhost` vhosts, since
  those are dispatched on the same port. Unverified beliefs: Android Chrome
  resolves `*.localhost` to loopback without DNS, and exempts `localhost`
  origins from mixed-content blocking so the hosted client can iframe them.
  Samsung's background-process killing makes it a tinkering path.
- **Emulators.** Not needed by any candidate; everything tested is a web
  target in the pane. An emulator enters only at Capacitor packaging time on
  a desktop, outside this loop.
