# Completion inventories are rebuilt after a server restart

`ProjectFileCompletion` retains project inventories only in memory. Restarting
YA loses them, and many simultaneously used large projects can consume a
substantial aggregate heap even though enumeration and each project are bounded.

The maintainer explicitly permits deferring disk persistence. If worthwhile,
store a disposable inventory in YA's private project-associated app-data
directory under the configured data root, not inside the selected project or
its Git metadata. A database is optional. Reuse the existing path/worktree
freshness observations and metadata fingerprints rather than introducing a
second independent change detector. Persisted state remains candidate data:
ignore eligibility, filesystem changes, checkout, and changes during a scan
must still be reconciled before treating it as current.

The current observable contract is in `topics/project-path-links.md`, under
"Composer path completion"; storage ownership is in
`topics/project-directory-storage.md`. No database implementation is required
for the current in-memory completion feature.

Found 2026-09-06 while bounding streamed completion and retaining many projects.
