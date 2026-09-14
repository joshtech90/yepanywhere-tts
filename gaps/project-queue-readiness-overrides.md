# Project Queue readiness has no per-project override

The agreed first version of the readiness check is server-wide, configured
under Settings → Message Delivery → Project Queue. This entry records the
deliberately deferred project-specific extension.
See [Project Queue](../topics/project-queue.md) and
[Project Settings Overrides](../topics/project-settings-overrides.md).

Later, Project Settings should offer three explicit choices:

- **Use server default** (the default): inherit the server-wide executable
  and arguments.
- **Custom**: replace the server check entirely for this project; never run
  both checks.
- **None**: disable readiness checking for this project even when the server
  default is configured.

Persist the choice in server-owned app-data project metadata. Absence means
inheritance; explicit None must survive subsequent changes to the server
default. Keep the existing waiting-caption and Force start bypass semantics.

Why deferred: the Maintainer requested the server-wide check first, without
the project-specific configuration and UI. Extend the settings resolver and
Project Settings surface when that scope is requested; do not add an unused
override schema to the first version.

Another deferred extension is a check that blocks until the project clears,
instead of exiting with a current verdict. For now YA polls using its existing
blocked retry cadence, never more frequently than once every 10 seconds per
project. A future blocking mode needs explicit cancellation on queue pause,
empty backlog, settings changes, and server shutdown, plus bounded subprocess
ownership. It remains advisory and need not atomically claim the project.

Found 2026-09-07 while designing the optional external Project Queue readiness
check. Contributing-model: gpt-6-astra.
