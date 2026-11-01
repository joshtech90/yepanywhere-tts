# Path segments stop short of the approved mockup in four places

Status: proposal only. Agent-derived from the 2026-10-29 implementation of
the File Viewer's clickable path segments
([media routing](../../topics/media-rendering-and-routing.md#resource-actions-and-file-presentation-choice)).

- **Other single-file path headers.** `BlameView`'s header and the local-file
  modal (`LocalMediaModal`) show a plain path. `PathBreadcrumbs` is
  navigation-free, so each can adopt it by supplying its own folder target:
  Blame might filter the Working Tree browser rather than open a list.
- **Git status letters in the folder list.** The mockup marked modified and
  untracked entries. The listing route reports filesystem facts only; joining
  the project's working-tree status (`git/working-tree-files`) on the client
  would add them without a second Git query per list.
- **Copy GitHub link for a folder.** The file link comes from the file's last
  commit (`getGitFileRevision`); a folder needs a `tree/<rev>/<path>` URL and a
  revision that is not one file's.
- **Open in Source Control for a folder.** `/projects/:id/browse?path=` opens
  the enclosing checkout without focusing a folder inside it, so the menu
  omits the item until that route can scope or filter to the folder.
