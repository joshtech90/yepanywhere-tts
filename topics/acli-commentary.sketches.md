# ACLI commentary presentation proposals

> Optional presentation ideas beyond the implemented commentary contract.

Topic: acli-commentary

## Low priority: downstream image galleries

The producer should continue emitting ordinary Markdown image references;
YA could group them after commentary has been decoded and rendered. Reuse the
existing compact image gallery's viewer and controls while retaining each
commentary item's context bullet, source order, and original output access.
Repeated references to the same capture in handoff prose and image Markdown
should not create duplicate thumbnails.

The current gallery collects assistant text render items before tool
commentary is available. Broadening that collector without preserving the
tool/block boundary would lose source ownership. An eventual adapter should
group within one commentary output, supply stable image-to-source identities,
and honor existing gallery and inline-expansion preferences.

This is an optional, very low-priority proposal. The current ordinary Markdown
table already presents the two capture sizes side by side; no gap or new image
link convention is needed.
