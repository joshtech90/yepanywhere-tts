# Development guides

[DEVELOPMENT.md](../../DEVELOPMENT.md) is the required contributor entry point.
It contains common rules and explicit task-reading triggers. Read the guides
that apply to the task; this directory is not an additional mandatory reading
list. Commands and code paths in these guides are relative to the repository
root unless stated otherwise.

| Guide | Use it for |
| --- | --- |
| [Local development](local-development.md) | Setup, command reference, ports, profiles, data directories, and feature configuration. |
| [Testing](testing.md) | Required source checks, cross-platform coverage, device-control testing, and ChromeOS debugging. |
| [Code quality](code-quality.md) | Warnings, Biome formatting, import/export edits, and mechanical cleanup. |
| [Client development](client.md) | UI translations and console budgets; links to CSS and visual verification owners. |
| [Provider development](providers.md) | Codex audit approval, pinned reference source, compatibility markers, and schema validation. |
| [Dependency maintenance](dependencies.md) | Audits, overrides, allowed install scripts, and advisory revisit triggers. |
| [Documentation and plans](documentation.md) | Document ownership, tactical step names, and retiring completed plans/gaps. |
| [Commit conventions](commits.md) | Commit motivation, formatting, provenance, and series threading. |
| [Debugging](debugging.md) | Server/client logs and the maintenance server. |
| [Releasing](releasing.md) | npm publishing, website releases, and the private staging runbook. |

Product behavior and durable technical contracts stay in their existing
`topics/` owners. In particular, use [CSS architecture](../../topics/css-architecture.md),
[UI design](../../topics/ui-design.md), [UI testing](../../topics/ui-testing.md),
[server capabilities](../../topics/server-capabilities.md#minimum-compatibility-horizons),
and [performance measurement](../../topics/performance-regression-suite.md#performance-measurement-hosts)
directly when applicable. Do not copy their procedures into parallel guides here.
