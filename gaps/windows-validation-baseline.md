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

2026-10-01 — the same cleanup family recurred in runtime run
[36892794005, attempt 2](https://github.com/kzahel/yepanywhere/actions/runs/36892794005/attempts/2):
Windows Node 24 passed the disabled SQLite startup state, then its temporary
root remained busy through Node's approximately 0.69-second deletion window.
Windows Node 23.11 passed all Node/Bun startup states, then Bun failed removing
the fixture root. Bun 1.3.14's recursive `rm` implementation ignores its parsed
retry options. Startup and clean-package teardown now share an explicit
2.4-second retry loop; permanent locks still surface the original error.
Native Windows regression cases run in the matrix under Node and pinned Bun
with a real child cwd held for one second and with a permanently held cwd.
Local macOS Node/Bun cleanup contracts, root checks, and fresh-package startup
pass. Repair `a5d1fa195` passed all twelve legs of
[runtime/SQLite CI 36899967037](https://github.com/kzahel/yepanywhere/actions/runs/36899967037),
including both real cwd-lock cases under Node and Bun on every Windows leg,
plus clean-package and locked-dependency startup. This narrow cleanup repair
does not close the broader Windows aggregate above.

2026-10-01 — auth-file recovery/durability validation on this Windows x64
Node 24.18.0 checkout again found the broader baseline: two `pnpm test` runs
reported 336–337 failed server tests and three unhandled ACL errors; the final
run had 5827 passed and 147 skipped. Five representative failing files
(limited-user directory grants,
project creation and metadata app routes, symlink containment, and public-share
storage) reproduced 74 failures from an unmodified `fb00746d3` source archive.
These are the same independent ACL, path and symlink families above, not safe
to fold into credential-file recovery. The credential, ownership-store and
atomic-write suites pass in a focused native run. Checkout formatting passes
after local CRLF normalization to bytes identical to HEAD; no formatting-only
repository changes were made, and this workaround does not close that gap.

2026-10-02 — Source Control error-feedback validation again hit this baseline:
the root server run reported 356 failed tests in 102 files and three unhandled
ACL errors, with 5,288 passing tests. The failures include the same unresolved
SID, symlink privilege, path/shell and provider-fixture families above; repairing
them together would expand an error-feedback change into independent platform
work. All 6,621 client tests, 939 shared tests and 130 relay tests passed.
Focused Source Control client checks passed 83 tests, and the Git execution and
status-route checks passed 35. Lint, formatting and typechecking passed; this
still does not establish a passing Windows aggregate.

Found 2026-09-12 while validating Windows directory-sync persistence fixes.
