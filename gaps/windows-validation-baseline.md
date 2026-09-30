# Windows full-suite and checkout-format validation remain incomplete

No truthful whole-repository Windows aggregate exists. Repeated runs on Windows
x64 and ARM64 under Node 24 leave the server unit suite with hundreds of
failures spanning independent families — `icacls` exiting 1332 over unresolved
SID entries in private-storage ACLs (public-share and provider-installation
tests), OpenCode reader tests holding SQLite files open and failing `EBUSY` at
cleanup, Windows symlink privileges, POSIX path and shell assumptions, and
watcher timing — while `pnpm test:e2e` stops in global setup at
`packages/client/e2e/global-setup.ts:173`, which builds a fixture directory name
by replacing only `/` and so leaves a drive colon and backslashes in it, and
`pnpm format:check` and `simple-client:check` fail on checkout-wide CRLF content
rather than on authored source. Closing this needs each family split to an owner
with native regressions, then one full Windows aggregate that passes — without
bypassing ACL enforcement, rewriting generated contracts, or reformatting the
whole checkout to make a gate green, since each of those hides the portability
defect instead of repairing it. Focused and exact-file checks do pass on
Windows; that is not the aggregate. Broader platform coverage is tracked in
[ci-platform-coverage-holes.md](ci-platform-coverage-holes.md).

2026-09-29 — origin's Server Runtime And SQLite run
[36500646071](https://github.com/kzahel/yepanywhere/actions/runs/36500646071)
at `3a0281f83` failed the Windows Node 22.16.0 leg during Bun startup-fixture
cleanup: both disabled and ready startup checks passed, then removing the
temporary `ya-sqlite-startup-*` directory failed with `EBUSY` under Bun 1.3.14.
The mirror's same-tip runtime matrix passed. This is a cleanup failure, not
evidence that SQLite startup failed; handle/process ownership needs diagnosis.
Contributing-model: 6-Astra.

Found 2026-09-12 while validating Windows directory-sync persistence fixes.
