# Project Captions

> A project caption is a one- or two-sentence description shown under the
> project name on Projects and in the session breadcrumb tooltip. The server
> derives it from the project's README, else a known manifest, caches the
> result for a day, and lets the user override it inline with a ✓/× editor.

Topic: project-captions

Status: **implemented (2026-09-20).**

## Approved project-local identity extension (not implemented)

A deliberate post-creation edit to a project's name or caption must record
the chosen text in `<project>/.project-identity.json`. This applies to every
YA project, including imported directories, independently of template use.
Initial creation-time name/intent remains provisional and does not create
this marker. Most projects need no file. The user explicitly chose this
project-local intrusion so agents and tools outside YA can respect the choice;
private YA app data is not an alternative authority. The file may be excluded
from Git at the user's discretion.

Version 1 contains `formatVersion: 1` and optional `name` and `description`
objects. Each present object has exact `humanText` and an `editedAt` timestamp.
The description additionally has `agentCoda`, initially empty. Its effective
text is `humanText + agentCoda`; the coda owns its leading separator. Names
have no coda. Missing entries are unprotected. Only a subsequent explicit human
edit/reset changes or removes the protected text. An agent may revise or remove
the coda while retaining the exact human string and timestamp. No trimming,
case folding, punctuation repair or prose reflow may rewrite the saved human
text. Display truncation must never be saved back into it.

The human editor edits its portion separately from the coda. YA must persist
the marker for the action to succeed, with safe path handling and concurrent
edit protection; a write failure cannot silently save only a private override.
Existing app-data overrides need a deliberate migration that distinguishes
creation-time choices from later edits. Invalid versions/content fail visibly;
they must not be treated as absence and overwritten. Name/caption operations
otherwise retain their normal authorization checks. Agent coda updates need
an explicit supported write path and cache invalidation; the current caption
route does not yet provide this separation.

The template base's **redoc** skill reads this file before changing identity
text, and uses the protected description as the README lede's exact prefix
and in existing manifest description fields. It freely reorganizes and
rewrites ordinary documentation for human/agent readability and truth against
current contents. It does not track authorship, infer protected prose from Git,
or create a marker merely because it encounters user-written documentation.
More restrictive editorial procedures can be supplied ad hoc. A project SVG
brand thumbnail leads the README as a separate Markdown image block.

This is the user's approved direction from 2026-09-21, not the current runtime
described below. The [identity gap](../gaps/project-local-identity.md) owns
implementation for all projects; the portable skill/format live in
`~/agents/project-templates/bases/base/redoc/`.

## User-visible contract

- Every project may carry a caption. Projects shows it directly under the name
  line — where the code-name chip also sits — and it is the only prose under
  that line, since the path and session counts share one footer row; the
  session header's project breadcrumb shows it in the tooltip after the full
  project name.
- With a capable server, clicking the caption on a project card (or the
  "Add a caption" placeholder when none is derived) opens an inline editor.
  Enter, blur, or ✓ saves; Escape or × cancels. Saving an empty field clears
  the override, so the derived caption returns.
- A caption reports its source. The tooltip names it: README, manifest, or
  custom. A custom caption wins over any derived text until cleared.
- The project card also gains a gear button that opens Project Settings
  directly. Removal is a trash button beside it; the three-dot menu that once
  held both actions is gone, since each remaining action now has its own
  control. Removal still asks for confirmation before anything happens.

## Derivation

Resolution order, first hit wins:

1. **Override** stored in YA app data (`projectCaptions` in
   `project-metadata.json`), never inside the project directory
   ([[project-directory-storage]] posture, as for [[project-code-names]]).
2. **README** (`README`, `README.md`, `README.markdown`, `README.txt`,
   case-insensitive; the first by name when several exist, first 64 KiB
   only). The first heading or paragraph that is sentence length: at least
   six words and 40 characters after stripping inline markdown. Skipped:
   YAML front matter, fenced code, any block containing an HTML tag, HTML
   comments, badge-only lines (images and links with no other text), list
   items, and tables. A short title heading like `# yepanywhere` fails the
   length test on its own, which is the intended way to pass over it.
3. **Manifest** description fields, in order: `package.json` `description`,
   `pyproject.toml` `[project] description`, `Cargo.toml`
   `[package] description`.

Captions are at most 300 characters. A longer README paragraph is cut at the
last sentence boundary inside the limit, else at a word boundary with an
ellipsis. Whitespace is collapsed.

Derived captions are cached in server memory per project path for 24 hours
so listing projects never rescans directories. A README edit therefore shows
up within a day or after a server restart; an override applies immediately
because it lives outside the cache. The current template content prototype
([[project-templates]]) seeds a readable summary during scripted setup and
leads its README with a separate thumbnail image block, which the heuristic
skips. Preparation then refines the initial summary through redoc.

## Wire contract

Capability `project-captions` (permanent ID 79, version-implied from
`0.8.2`) owns:

- the additive `caption` field (`{ text, source }`, `source` one of
  `override | readme | manifest`) on `GET /api/projects`,
  `GET /api/projects/:projectId`, and `POST /api/projects` responses;
- `PATCH /api/projects/:projectId/caption` with `{ caption: string | null }`;
  `null` or an empty string clears the override; the response carries the
  resulting effective `caption`;
- the `project-captions-changed` event naming the changed project ids, which
  the client uses to revalidate project lists and the selected project.

The reviewed stable corpus is v0.8.0 (2026-08-31) and v0.8.1 (2026-09-05);
both lack the field, route, and event. Without the capability the client
shows no caption anywhere, hides the editor, and sends no caption request.
No existing capability changes meaning.

## Related contracts

- [[project-code-names]] — the other server-owned, user-editable project
  label; the caption editor follows its inline-edit pattern.
- [[project-settings-overrides]] — app-data ownership for project-scoped
  state; the caption override is identity metadata rather than a session
  default, but lives in the same file.
- [[project-templates]] — scripted setup seeds the README and preparation
  refines its description.
