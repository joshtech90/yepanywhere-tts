# Project Names

> A project's name is the last component of its path unless the user chose
> another when adding it. The Projects add form shows the name and code the
> project will get and lets both be changed before the project exists; a
> chosen name is app-data metadata applied wherever the project is named.

Topic: project-names

Status: **implemented (2026-09-20).**

**Approved extension, not implemented:** deliberate post-creation human naming
must be recorded inside every affected project in `.project-identity.json`,
so redoc and other agents preserve the exact name outside YA. Creation-time
choices remain provisional and create no marker. See the
[identity contract](project-captions.md#approved-project-local-identity-extension-not-implemented)
and [implementation gap](../gaps/project-local-identity.md). This deliberately
changes the storage posture for that specific later edit, not the current
runtime described below or unrelated metadata families.

## User-visible contract

- **Adding a project** takes a path, a name, and, when Short Project Code
  Names are enabled in this browser, a code. The name and code follow the
  path as it is typed: the name is the path's last component and the code is
  the same allocation the server would make from that name against the
  projects already listed. Typing into either field detaches it from the
  path; clearing it hands it back to the default. The defaults are visible
  values, not placeholders, so a user who wants them submits without touching
  them.
- A name that still equals the path's last component is no override. Only a
  differing name is stored; renaming the directory later therefore changes
  the name of a project that was never explicitly named.
- A chosen name is the project's name everywhere: project cards, sidebar
  rows, session breadcrumbs, All Sessions rows and its project filter, and
  the source name the code-name allocator reads. A chosen code takes the
  same path as an explicit edit on Projects, so it wins over the generated
  value and displaces a conflicting project's generated code.
- Confirming the form opens a new session in the project. A just-added
  project has no sessions to list, so the earlier landing on its empty All
  Sessions view was a detour.
- Removing a project drops its chosen name with its other metadata; adding
  the path again starts from the path's own name.
- Project list changes are announced. Adding, removing, or renaming a project
  emits `projects-changed`, which refreshes project lists and advances the
  global session collection so the All Sessions project filter neither keeps
  offering a removed project nor misses a new one. Before this event the
  filter's list came from a generation-gated cache that nothing bumped on
  add or remove.
- The name is invalid when longer than 80 characters after collapsing
  whitespace; a rejected request adds nothing. The code follows the
  [code-name rules](project-code-names.md#character-and-editing-rules), and
  the form checks it before sending.

## Storage and compatibility

The override lives in `projectNames` of `project-metadata.json`, never inside
the project directory ([project directory storage](project-directory-storage.md)
posture, as for [code names](project-code-names.md) and
[captions](project-captions.md)). The scanner keeps the path-derived name in
its snapshot and applies the override on every read, so a rename needs no
rescan.

Capability `project-names` (permanent ID 80, version-implied from `0.8.2`)
owns the `name` and `codeName` request fields on `POST /api/projects`,
`PATCH /api/projects/:projectId/name` (a string sets, empty or `null` clears),
and the `projects-changed` event. The reviewed older server corpus is v0.8.0
and v0.8.1; without the capability the add form is path-only, the client sends
neither field, and the project takes its path name as before. An older server
that received the fields would ignore them and add the project under its path
name, which is why the fields are gated rather than sent optimistically.

## Related contracts

- [`project-code-names.md`](project-code-names.md) — allocation and editing
  rules the form's code field follows.
- [`project-captions.md`](project-captions.md) — the description shown under
  the name on Projects.
- [`all-session-content-search.md`](all-session-content-search.md) — the All
  Sessions project filter that this event keeps current.
