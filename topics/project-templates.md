# Project templates

> Config-driven project creation from composable capability bases, with
> vendored instructions, deterministic setup, and an automatic preparation
> session. Source retrieval is implemented; project creation remains pending.

Topic: project-templates

Status: **Source settings implemented; project creation pending (2026-09-21).**
The implementation handoff is
[usable template projects](../docs/tactical/132-project-template-implementation.md).
The authoring library is `~/agents/project-templates`, committed
in the agents repository at `d6a64e9` (App canvas/format) and `4baf1bf` (Web page,
shared web tooling and explicit project-visible skills). Its manifests remain `draft` while the
portable-instruction review is open. YA now has a native library loader and
composer in `packages/server/src/projects/template-library.ts`, with no Python
runtime dependency. It validates the complete inventory without executing setup,
retains the loaded file bytes, and refuses drafts through its creation accessor.
Settings now fetches ordered GitHub sources into private, revision-stamped
snapshots, reads local overlays directly, and shows their combined inventory.
Materialization, creation routes
and template permissions remain unimplemented. See the
[stand-up integration gap](../gaps/project-template-standup.md).

## Current contract — config-driven templates

This section supersedes conflicting statements in the historical design below.
`~/agents/project-templates/FORMAT.md` is the authoring format authority;
`composition.py` and its conformance tests implement the initial local format.
This YA topic owns its product integration, not a second evolving schema.
The user-facing [template-authoring guide](project-template-authoring.md)
explains how to create and share a source; its synchronized copy is the
agents library's `project-templates/README.md`. Keep cache and protocol details
here rather than in that guide.

### Sources and inventory

A configured source has a stable source identity, a local repository or GitHub
repository/ref, and a repository-relative content directory. The overridable
default is `https://github.com/graehl/agents` with `project-templates`, not the
host's `~/agents` checkout. Fetch on enable and on an origin change while
enabled; repository, content root and revision identify that origin. Save
disabled configuration changes without fetching, then validate on enable.
Reject a missing content directory during admission. Resolve remote refs to a
fixed revision and validate and instantiate
that same revision. An unreachable source is an error, not an empty library.
Validate inventory, manifests, dependency order and referenced files without
executing scripts; revalidate a mutable local source before creation.

Use a private source cache outside YA's checkout; a full clone initially
preserves references to sibling topics and skills. A standalone repository or
YA submodule is not required. Efficient retrieval of the configured path plus
its transitive dependencies is tracked in the
[selective retrieval gap](../gaps/project-template-selective-retrieval.md).
The settings use an ordered list of GitHub and local sources. Each row has
one **GitHub or local dir** field; append a GitHub content path to the repository
URL, or enter an absolute/`~/` local directory. GitHub revision is separate.
The wire contract retains repository, relative content path (empty means root),
revision and stable source ID. `graehl/agents/project-templates` is the default;
vendoring it in YA later remains an option.

Local directories are read directly, never copied or rewritten. A containing
Git worktree supplies the repository boundary and informational HEAD; without
Git, the selected directory supplies the boundary and the commit is null.
Every update revalidates local working files, even at an unchanged HEAD.
There is no local content-hash verification. Mixed local/GitHub overlays use
the same definition ordering and composition rules. Creation must revalidate
mutable local input rather than treating HEAD as an immutable content pin.

**Layering:** later sources replace earlier base/template definitions with the
same ID. A base cannot change into a template or vice versa. Validate the
combined dependency graph, allowing community templates and bases to extend
YA-default bases without copying them. Source-file references stay inside the
repository owning that definition. Root file composition still requires exact
bytes/modes or explicit overrides; source layering is not implicit overwriting
of project files. The inventory reports each effective template's source ID.
Future creation grants must match that origin plus template ID, so shadowing a
template does not silently redirect a limited user's saved grant. An intentional
base replacement changes templates depending on it and requires source review.

**Retrieval and relocation:** `GET`/`PUT /api/project-template-source` are
superuser-only source administration. The feature defaults off. Fetch resolves
each configured GitHub ref to a commit before downloading, then validates the whole
combined library without executing setup. Raw shallow Git checkouts remain
unchanged under `dataDir/project-templates-source`; a separate translated
snapshot rewrites explicit `~/repository-name` text references to the matching
retrieved repository. Later sources supply duplicate repository-name aliases.
Binary files and source symlinks are not rewritten. A dependency update rebuilds
translation from raw content, including cached community dependents. Project
export must subsequently relocate references to vendored project destinations;
cache paths are not a generated project's runtime dependency.

**Manual updates:** display each fetched SHA and the effective inventory.
`HEAD` selects the remote default-branch tip at explicit fetch time. A named
branch/tag or full SHA selects another revision. Update checks remote refs
first; unchanged commits and source order reuse the admitted snapshots and
report Already up to date without downloading repository content. Updating
from the default branch sets that source's revision to `HEAD`. Poll only while
a retrieval is active, and preserve in-progress field edits during status
updates. Failed/interrupted retrieval is explicit and does not admit a partial
library; the last successful snapshot may remain visible as prior content.
Automatic chooser-triggered checks are only a
[sketch](../gaps/sketches/project-template-automatic-updates.md).

**Compatibility:** capability `project-template-sources` owns only retrieval,
source configuration and inventory. Older servers show no source controls and
receive no source requests. This does not advertise the still-unimplemented
creation/workspace or identity contracts. Approved optional corpus:
v0.8.0/v0.8.1, both without these routes.

```text
project-templates/
  PROGRAM.md, FORMAT.md, library.json
  bases/<id>/template.json       # reusable capability + explicit file list
  templates/app-canvas/template.json
  templates/web-page/template.json
  composition.py                # local reference implementation
  project-template.py            # authoring CLI, not a YA runtime dependency
```

`library.json` has `formatVersion: 1` and finite `bases` and `templates` ID
lists. Each manifest declares `formatVersion`, `kind`, `status`, `id`, `title`,
`description`, ordered `extends`, `files`, and `overrides`. A file maps `from`
to `to`, with optional `executable` (default false). Source paths are relative
to their manifest. `../` and source symlinks are permitted only within the
source repository; output contains ordinary copied files. Broken links,
repository escapes, Git metadata, invalid destinations and case-folded or
file/directory destination collisions fail before materialization.

Templates can also vendor project-visible skills in conventional harness
discovery directories, with their complete scripts/resources. They use the
same explicit file maps and collision rules, not a separate YA skill registry.
The README introduces their purpose and normal invocation so beginners,
including limited users, can learn to use them. Verify harness discovery in
addition to checking that files were copied.

An optional composed `.project-template/preview.svg` supplies the chooser's
template illustration without running setup. It follows ordinary file maps,
collision rules and vendoring. Render the self-contained SVG as an image with
the template title as accessible text; do not inject its markup into the page.
App canvas supplies the drawing graphic from the reviewed mockup. This asset
represents the template type, not the eventual app's screenshot.

### Composition and collisions

Multiple bases are an ordered dependency graph. Apply each shared ancestor
once, before its dependents, while respecting each `extends` order. Stable
topological sorting uses first encounter in a left-to-right depth-first walk
to break unconstrained ties. Cycles and incompatible ordering constraints are
errors; the selected template contributes last.

- Ordinary files at the same destination coalesce only when their bytes and
  executable mode are identical. Different paths remain separate even if
  their contents match. Differing bytes or modes are conflicts, never an
  implicit last-writer-wins overlay.
- Exact root `AGENTS.md` is special: hash each complete fragment's original
  bytes with SHA-256, retain the first occurrence of each hash, then concatenate
  in resolved order with blank-line boundaries. Do not normalize or deduplicate
  paragraphs. Nested `AGENTS.md` files are ordinary files.
- The selected template applies explicit ordered overrides after composition:
  `replace`, `prepend`, `append`, or `omit`. Replacement and omission can
  resolve a conflicting destination; appending/prepending cannot choose a
  predecessor from conflicting content. Text operations require an existing
  UTF-8 destination. There is no JSON deep merge or implicit glob expansion.

The reserved `base` contains only universal instructions. The populated
capability bases are `software-engineering`, `testing`, `typescript`, `web-ui`,
`web-app`, `canvas`, and `server`; their dependencies select the relevant union.
`legacy-boot` is a separate draft authoring reference to the global boot,
excluded from App canvas. Full global research/run/session-management policy
is not part of an instantiated app's instructions. Systematic editorial and
experimental tightening remains the agents repository's
`project-templates/gaps/portable-capability-bases.md` work.

### First template: App canvas

The stable ID is `app-canvas`, display name **App canvas**. It creates a static
Vite + TypeScript Canvas2D app, with run/test/build tooling and vendored
instructions. It has no application server initially. The server base supplies
an inactive add-on: `npm run server:add` later installs the supplied Node
server and health endpoint, updates runtime configuration, and refuses to
overwrite an existing server. Instantiated projects stand alone; neither
their instruction routes nor build/test/run/add-on commands require `~/agents`.

`.project-template/app.json` describes `kind`, static bundle `dir`, argv arrays
for `setup`, `build`, `test`, `preview`, a vendored `prepare` prompt, and
`addons.server`. Activating the server adds `start`. Commands run in the
project directory without shell interpolation. `.project-template/project.json`
records entered name/description and composition provenance. The initial CLI
consumes setup; YA orchestration remains to be implemented.

The build has relative asset URLs and works over static HTTP(S), including
artifact grants. ES modules do not promise `file://` execution. The portable
template includes deployment guidance but no personal publishing destination
or automatic publish. The existing static server binds loopback. Live tablet
console forwarding, PWA packaging, and pane annotation are future integration,
not capabilities of the current template. Browser verification uses Playwright.

### Web page and shared tooling

The second content prototype is **Web page** (`web-page`), a content-led DOM
starter for prose, documents, stories and collections. Its working sample has
searchable/filterable cards. Interactivity and multimedia remain available;
its instructions emphasize reader purpose and content structure. Both starters
inherit `web-app` for deterministic Vite setup, run/test/build, preparation and
the inactive server add-on. Web page does not inherit canvas instructions.

The agents gap `project-templates/gaps/content-authoring-capabilities.md` owns
optional writing skills and guidance (plot, characters, worldbuilding,
continuity), plus shared static-publication onboarding. Publication defaults
to a host-provided URL such as GitHub Pages; account/domain onboarding is
future work, and buying/configuring a custom domain is optional.

### Creation and preparation

Projects gains a **New project** surface with **From template** and **Existing
directory** modes for the superuser. Template creation asks for name, intent,
and parent directory; a single available template is applied automatically.
Existing-directory registration keeps its present behavior. The current
proposal fixture lives in `packages/client/mockups/project-templates/` and
reuses the real existing-directory form and settings section component.

**Create & prepare** explicitly authorizes the following sequence:

1. Validate permission, source revision, prerequisites, fresh target and app
   name reservation before executing source-controlled setup. Resolve and
   vendor the complete selected content into the new directory.
2. Run deterministic setup, initialize Git and register the project with its
   ownership. Make the starter visible in the App pane as soon as its build
   is usable; do not wait for the agent's preparation turn.
3. Open a project-context session and automatically send the vendored prepare
   prompt with the entered intent as user data. Use the user's provider/model
   settings and enforce limited-user locks and sandboxing. The turn customizes
   project instructions, refines the README lede, verifies run/test/build,
   and reports readiness to build the requested app.

Setup seeds a reasonable README summary immediately, so the project description
does not remain blank while preparation runs. The shipped base instruction
keeps documentation current, including revising that lede when the project's
purpose changes. Preparation failure leaves the usable starter and session
visible with a failure state; it must not silently recreate the project or
send a duplicate first turn. Setup failure reports the partial directory and
logs without registering a successful project or deleting user content.
Creation grants no authority to deploy or publish.

The universal base vendors the **redoc** skill. It improves the documentation
hierarchy for human and agent readers, checks truth against current contents,
and creates/refreshes a project-specific `docs/brand.svg` leading the README.
It is ordinary autodoc, not an authorship tracker or protected-prose system.
Its built-in identity exception is the root `.project-identity.json`: later
YA-UI human edits preserve exact name/description text, while the agent may
revise a description coda. Initial creation values remain provisional and
create no ownership marker. This exception applies to all YA projects; see
the [identity contract](project-captions.md#approved-project-local-identity-extension-not-implemented).

### Limited-user permissions

Settings → Users extends the existing local principal's grants, rather than
introducing a second user system. The server enforces a per-user choice:

| Choice | Creation permission |
|---|---|
| None | No new projects. Existing project access is unaffected. |
| Selected templates | Only saved source-qualified template IDs. Empty means none. |
| Any configured template | Every enabled, ready template, including future additions. |

New limited users default to Selected templates with all three templates at
agents HEAD `947fc67`: App canvas, Storybook and Web page (user-directed
2026-09-21). These are source-qualified selections, not an Any grant to future
templates. Exactly one permitted available template is applied without a picker;
multiple templates offer a chooser. A removed/unavailable/draft template never
silently falls back to another. Limited users cannot supply a source, script,
arbitrary directory or permission grant: the superuser's configured project
root is enforced at creation, and the new project belongs to that user.
Missing project root prevents creation even when a template is allowed.
The approved migration preserves existing users' project-only confinement and
disables template creation until explicitly granted; new defaults apply only
to newly created users.

The proposed chooser uses compact radio cards above the creation form: title,
one-line purpose, and a visible selected state. The selection updates the
template details and preserves the entered project name/intent. Both superuser
and limited-user flows use it when more than one permitted template is available;
limited users still supply only name and intent. Both content prototypes exist
in the authoring library; neither draft is production-admitted yet.

Project lists show ownership as `alex / Sketch garden`, separately from the
project's name, following the existing owner display convention (a configured
code name still takes precedence). New limited users default their parent to
`~/username`, editable by the superuser. That **Create in** directory also
becomes their default writable sandbox. Alternatively the superuser locks
Current project only: each session writes only its active project, including
an outside project with an explicit new-session grant. The limited user does
not choose this mode at session creation. Other directories remain read-only
under the existing sandbox's read policy. The directory and display name need
not encode the creator.
[Limited users](limited-users.md#approved-workspace-direction-2026-09-21-not-implemented)
owns this approved, unimplemented extension. Creation fields use muted examples
as placeholders, not prefilled app specifications.

### Persistent app-name reservations

Settings → Apps owns the superuser's wildcard-domain configuration and reserved
names, alongside existing app routing. For a configured wildcard such as
`*.graehl.org`, the first successful reservation wins. Claim names atomically
on the server, normalized within the configured namespace; a conflict asks
for another name rather than renaming silently. Service-owned names are
unavailable. A name reservation is separate from a running port or process.

Reservations persist across restarts, stopped apps and project deletion, until
explicitly cleared by the superuser. Preserve enough project/owner information
to explain orphaned entries. Limited users can claim available names for their
authorized projects but cannot release or take over reservations. The superuser
view shows hostname, project/owner, serving-or-reserved status, and a Clear
action that confirms release and the resulting loss of that app address.
Clearing does not delete project files. Namespace removal/reconfiguration must
not silently release claims. This is a YA namespace contract, not a claim to
control arbitrary DNS names outside its configured routing.

The isolated mockup's **App names** layout was approved on 2026-09-21. Persistent
reservation storage, concurrency and authorization remain unimplemented and
are included in the stand-up gap. Host-provided static publication is a separate
path and does not require this wildcard.

### Next delivery boundary

The source library and local stand-up prototype exist. The user approved all
existing UI prototypes on 2026-09-21: New project, template choices, preparing
project, Settings → Users and App names. Proceed from the
[implementation handoff](../docs/tactical/132-project-template-implementation.md),
including capability gating for older servers and server-side authorization.
The separate supported-release capability/fallback plan is approved in that
handoff; implement its gates without broadening existing capability meanings.
The [gap](../gaps/project-template-standup.md) owns the remaining
integration and acceptance checks. Import/export, save-as-template, extra
templates, landing slash commands and advanced template authoring remain later
work. Basic Settings → Project templates source configuration and explicit
feature enablement are prerequisites for the initial usable flow.

The superuser authoring follow-up lives in
[project-template editor](../gaps/project-template-editor.md): Settings → Project
templates enables the feature, accepts the default `graehl/agents` bundle or an
alternative local/GitHub/submodule source, edits the source location in place,
and composes ordered bases plus extra AGENTS text. An explicit Update action
validates upstream HEAD and advances the selected revision; it does not silently
update instantiated projects. This editor has not been mocked up or implemented.

## Historical prompt-first design

The remainder records the September 19–20 proposal and its broader reach
requirements. Its template anatomy, source locations, `canvas-ts` name,
prompt-first assembly, staged first turn, fixed personal publish target and
phase order are superseded by the current contract above. Runtime/pane ideas
below remain proposals and do not describe delivered template functionality.

## The idea in brief

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

## Motivation

Reproducibility is the first win: the tree, the project `AGENTS.md`, and the
first prompt are curated once and reused, and a user can save a project shape
they like back into a private library. The second win is the novice case
from [[interactives]] (tap, describe the game, play it): that only works when
the agent starts from a tree it already knows how to extend, rather than
inventing a build setup under a child's first request. The third is
contribution: because a template is a directory of markdown and starter
files, anyone can propose a new default by pull request without reading YA's
source.

## Vocabulary

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

## Template anatomy

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
  built bundle to a GitHub Pages checkout and pushes it. The initial target
  (decided 2026-09-20) is a project-named subdirectory of the existing
  `ya.graehl.org` Pages repository, so `https://ya.graehl.org/<name>/`
  serves the game with one existing credential and checkout, following the
  same rules as the hosted-client publish in this checkout: `rsync` without
  `--delete` so previous hashed assets survive the CDN's ten-minute HTML
  cache, and a `404.html` copy of the entry only if the app needs it. A
  per-project repository or custom domain is a later option.

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
which the caption appears on Projects without any YA-side registration. The project `AGENTS.md` names both
and nothing else about running the app; `template.json` `app` records the
directory and whether `start` exists, which is what the create flow reads to
pick a reach path and what the App pane reads to know what to show.

### Prompt-based element layer

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

## Library locations

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

## Creating a project from a template

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

## Reach: what each shape can use today

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

## Stack decision

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
  are out. The reasoning for each set-aside option is in
  [`project-templates.sketches.md`](project-templates.sketches.md).

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

## Runtime observability: where the agent sees the app's console

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

## Reaching the pane from a tablet over relay

The encrypted relay carries only YA protocol. Grant management rides it, but
artifact documents and vhost apps travel directly from the browser to the
artifact origin, which must be reachable on its own
([[active-content-security]] § Configuration and delivery). Serving the
hosted client over https therefore says nothing about whether the pane can
load the app.

**Chosen path: a public wildcard to the artifact listener.** This is what
the design already assumes: the operator tunnels `*.<root>` to the artifact
port with Host preserved. On this deployment the `*.graehl.org` wildcard DNS
record already exists, so what remains is one catch-all ingress rule on the
existing `cloudflared` tunnel to `127.0.0.1:4402`, ordered after the
specific `relay` and `ya` hostnames, and `graehl.org` as the public root in
Settings → Apps. After that `breakout.graehl.org` works from any device with
no client software, vhosts stay behind the app-scoped bearer, and static
bundles use the artifact origin the same way. Reserved app names must then
also avoid the hostnames already in use on that root (`relay`, `ya`, `www`),
which the reservation collision check should cover.

The wildcard is per YA server deployment: each operator brings their own
DNS record and tunnel, and the relay is uninvolved. Name reservation is
likewise local to that server's Apps rows; there is no public or shared
name registry. A deployment without a public root has no vhost reach from a
remote tablet, so a template must still work when only artifact-grant static
delivery is available, and the chooser should say which reach paths the
current server offers. Tailscale,
an SSH tunnel from the tablet, and emulators were weighed and set aside; see
[`project-templates.sketches.md`](project-templates.sketches.md) § Reach paths.

## Phases

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

## Open decisions

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

## See also

- [[interactives]], [`interactives-architectural-review.md`](interactives-architectural-review.md)
  — app reach, isolation posture, and the hosting boundary.
- [[active-content-security]] — artifact grants, vhost rows, private app
  links, and the CSP that bounds static wasm/JS bundles.
- [[session-right-pane]] — where a created project's app appears beside the
  session; owner of the iframe `allow` grants and the pane half of the
  console/comment channel.
- [`project-templates.sketches.md`](project-templates.sketches.md) — stacks
  and reach paths weighed and set aside, with the reasoning.
- [[project-directory-storage]] — what YA may write inside a project after
  creation.
- [[emulated-slash-commands]], [[bang-commands]] — the composer command
  mechanisms `/start-project` joins.
- [[vanilla-defaults]], [[session-ui-customization]], [[server-capabilities]]
  — gating for the new UI surfaces and endpoint.
