# Android host runtime does not yet provide a reproducible dev tool layer

The Pixel 9 Alpine/PRoot host can build a native APK in roughly 30–50 seconds,
but its minimal replaceable payload lacks a durable contributor setup. Node was
present without npm/pnpm/JDK, and the JDK and SSH client later disappeared while
persistent HOME and downloaded tools survived. Ad hoc guest package installs do
not fix payload reproducibility. Record a pinned optional developer layer rather
than growing the normal host runtime unconditionally.

Shared-storage checkouts add separate problems: execution and dependency symlink
creation are unavailable; private worktrees are required for pnpm dependencies.
Git reported dubious ownership for the PRoot-created private worktree, and the
initial Husky prepare failed before its exact safe-directory entry was added.
OpenSSH known-host updates also failed on shared-storage hardlinks. Keep trust
files private and strict verification enabled; do not paper over this with
wildcard safe-directory settings or disabled host-key checking.

The new on-phone builder addresses the ARM64 SDK-tool mismatch explicitly, but
ordinary contributor checks still need independent qualification. Full lint/
format attempts stalled in native Biome or TSX stages; typecheck remained at
shared tsc and tests at shared Vitest startup. Single-file Biome completed with
one Rayon thread, but full runs still stalled with both thread limits. These
runs were cancelled after minutes without completion. No source failure was
established, and these checks must not be described as passing. Diagnose a
small repeatable fixture on the physical PRoot runtime before choosing a fix.

The [on-phone guide](../packages/android-host/docs/phone-build.md#minimal-alpine-development-friction)
records requirements and separate successful native/focused checks. No ordinary
runtime upgrade, source-wide test relaxation or dependency change was made to
mask these limitations.

Found 2026-10-18 while preserving the on-phone native build and disposable Lab
workflow in Git at the user's request.
