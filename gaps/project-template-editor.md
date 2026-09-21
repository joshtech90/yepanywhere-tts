# Superusers cannot configure or compose project templates in Settings

The initial library exists in `~/agents/project-templates`, but YA has no
**Settings → Project templates** page. The basic editor and source controls
should share that page, avoiding a separate navigation just to change where
templates are stored. This is a user-requested follow-up to the initial
[stand-up integration](project-template-standup.md); creation mockups do not
implement an authoring interface.

## Intended first editor

- Enable the feature explicitly here, accepting the default `graehl/agents`
  bundle or choosing an alternative. Preserve the default-off opt-in boundary.
- Display and edit the local repository path, GitHub repository/ref, or shipped
  submodule source, plus its relative content directory. The initial default
  content path is `project-templates`; a local authoring checkout such as
  `~/yep-project-template` is an example, not a second fixed convention.
  Configure supplementary sources alongside the primary source.
- Create/edit a named template by selecting an ordered set of bases and adding
  project-specific AGENTS text. Show the resolved base order, composed files,
  resulting AGENTS text and any conflicts before saving. Use the existing
  format's explicit overrides when needed; never introduce silent overlays.
- Save into an explicitly writable local authoring source. A shipped/pinned
  source needs a copy-to-local customization path, not unnoticed mutation of
  installed content. Direct GitHub writing and Git pushes are not implied.
- Provide **Update** beside the source. Resolve its upstream HEAD, show old/new
  revisions, validate the candidate content, then advance the selected pin.
  For a submodule this corresponds to moving to upstream HEAD; implementation
  must distinguish an editable development submodule from immutable installed
  bundles. Refuse dirty-source overwrite and retain the last valid revision
  when fetching or validation fails. Listing never advances pins by itself.

Sources keep stable identities so changing a local path or updating a revision
does not accidentally grant a different source's template to a limited user.
Changing inventory must preserve Selected-vs-Any semantics and show unavailable
selections rather than silently substituting a template. Existing instantiated
projects retain their vendored content; source updates do not rewrite them.

## Closure evidence

Review the editor mockup, then enable the default source, configure a valid
alternative and reject a missing content root. Compose two bases plus extra
AGENTS text, inspect deduplication/conflicts, save, and instantiate through YA.
Exercise local and GitHub updates, dirty-source refusal, failed validation and
supplementary-source identity without changing existing projects or grants.

The owning contract is [project templates](../topics/project-templates.md).
This remains separate from the currently reviewed creation and Users UI.

Found 2026-09-21 while reviewing project-template creation and limited-user
settings. Contributing-model: 6-Astra.
