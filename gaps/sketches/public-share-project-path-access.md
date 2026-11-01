# Public shares cannot opt into browsing a project's paths

Status: proposal only; not urgent. User-directed, 2026-10-29.

## Purpose

A public share of a project document or session grants exactly the files it
names and links ([share gating](../../topics/relay-origin-and-share-gating.md)).
A reader of a shared paper section therefore cannot step to the sibling
sections the way the authenticated File Viewer's clickable path segments allow
([media routing](../../topics/media-rendering-and-routing.md#resource-actions-and-file-presentation-choice)).

Proposal: a per-project option that, when the owner enables it, lets a public
share of that project's documents or sessions also list and read the
project's paths, so the share viewer can offer the same folder segments.

## Constraints any design must keep

- **Opt-in, per project, never retroactive by surprise.** Enabling it widens
  every live share of that project from named files to the project tree,
  including links already sent. The option's description and the share dialog
  must say so; turning it off must narrow existing shares again.
- **Live folders expose future files.** A folder grant read live shows files
  added after the share was made. A frozen revision would list and read from
  its copy-on-write clone only, and refuse the option where no clone exists,
  rather than silently reading the live tree
  ([share persistence](../../topics/public-share-persistence.md#frozen-project-files)).
- **Session shares multiply the reach.** A transcript names many paths; with
  this option a session share would reach the whole project, not the folders
  it mentions.
- **Exclusions.** Git metadata, ignored and locally excluded paths, dotfiles
  and symlinks leaving the project stay unlisted and unreadable, whatever the
  option says.
- **No path-existence oracle without the option.** Without it, shares keep
  today's rule: no listing route, no project scan, no version request from the
  share viewer.

## Shape

The share viewer source gains a listing method only when share metadata
advertises the grant, through a scoped share capability rather than the server
capability `file-folder-listing`, which covers authenticated reads only. The
server serves a share-scoped `files/list` that applies the share's project
root and the exclusions above.
