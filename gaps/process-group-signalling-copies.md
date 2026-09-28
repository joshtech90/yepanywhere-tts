# Server child launchers each hand-roll process-group signalling

`signalProcessTree` and `processTreeSpawnOptions` in
`packages/server/src/utils/processTree.ts` own "start a command as its own
process group and signal the whole tree" (POSIX `detached` plus
`process.kill(-pid)`, Windows `taskkill /T /F`). Only
`ArtifactRebuildService` uses them. Three older launchers keep private copies
that already differ:

- `ProjectQueueReadinessCheck.stopChild` — bounded `taskkill`, then kills the
  child and destroys its pipes; POSIX group SIGKILL, rethrowing non-`ESRCH`.
- `BangCommandService.signalEntry` — group signal with a silent fallback to
  the child; no Windows tree kill.
- `signalGatewayChild` in `sdk/providers/claude-gateway-launcher.ts` — group
  signal on POSIX, plain `child.kill` on Windows.

So a Windows bang command or gateway start command that starts helpers leaves
them running when YA stops it, while the readiness check and rebuild do not.
Not fixed in place: each caller's stop sequence (grace, pipe handling,
disposal waits) is its own contract, and migrating them was outside the
rebuild-timeout fix. The cheap fix moves each caller onto the shared helper,
keeping its own timing, and checks on Windows that the tree is stopped.

Found 2026-09-27 while fixing harsh review 69501d94..f2daae2c item [14-7]
(rebuild timeout left grandchild processes running).
