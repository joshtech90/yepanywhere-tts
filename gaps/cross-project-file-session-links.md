# File links start sessions in the conversation's project

An authenticated conversation in project A can name an existing file owned by
project B. The file menu's new-session action currently carries A's project
identity, even when the full file path identifies B. Reading an allowed
external file is already supported; selecting its owning project for a new
session is the missing behavior.

## Evidence and owning surfaces

Inspected at `8b621681a`:

- `packages/client/src/components/LocalMediaModal.tsx`:
  `normalizeResourceForProjectContext()` compares a local file only with the
  current project root. The resource context menu calls
  `startNewSessionFromFile(projectContext.projectId, ...)`, including for
  external file paths.
- `packages/client/src/components/FilePathLink.tsx`: `FilePathLink` passes its
  supplied project ID and viewer path to `useStartNewSessionFromFile()`.
- `packages/client/src/components/FileResourceActions.tsx`:
  `useStartNewSessionWithPrefillAction()` uses the supplied project ID and
  prompt verbatim; it does not resolve the file's owning project.
- [topics/project-path-links.md](../topics/project-path-links.md) currently
  specifies that confirmed absolute paths open through the active session
  project. [topics/relative-filenames.md](../topics/relative-filenames.md)
  owns display shortening. Neither display shortening nor successful file
  access establishes the correct project for a new session.

## Requested outcome and acceptance

The user wants actual file references in ordinary Conversation view, without
expanding tool activity. Agents will echo a full absolute or home-relative
locator, either directly or as a Markdown link target. A project-relative link
label is cosmetic; a full path remains valid input within its owning project.
There is no required `done:` prefix or separate notice after each revision.

- From A, a bare full path or `[gaps/example.md](<full path in B>)` supports
  viewing the current file and opening New Session with B selected and
  `gaps/example.md` prefilled. The path target determines ownership; a label
  must not retarget it to A or another same-named file.
- Recognize `~/project/...`, its expanded absolute spelling, and its fully
  resolved spelling when the project root is a symlink. Resolve the home
  directory and filesystem identity on the connected server, not the browser.
- Cover same-project paths, aliases of one project, identical relative names
  in different projects, and nested project roots. Specify deterministic
  ownership for overlapping roots; never silently select the conversation's
  project when it differs from the resolved owner.
- Keep missing, inaccessible, or unowned files explicit rather than inventing
  a project. Preserve authenticated file-access checks and public-share
  restrictions. Test the existing direct and remote link-action paths.

The likely fix belongs in shared file-target ownership resolution, consumed
by rendered links and their new-session actions. Reuse exact filesystem
lookup and the project registry rather than crawling project file inventories.
Home-alias parsing and symlink ownership support need a focused implementation
audit; this inspection does not establish their current coverage. If the fix
requires a new server contract, follow the existing compatibility review before
making the hosted client depend on it.

Deferred here because this spans project resolution and multiple link-action
surfaces; it is larger than the adjacent instruction preference. The user
explicitly authorized recording a YA gap instead of implementing immediately.

Found 2026-09-07 while landing the user's conversation file-reference preference.
