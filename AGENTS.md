# Yep Anywhere Agent Instructions

If `AGENTS.local.md` exists, read it before acting. Its machine-local
instructions take precedence over this file.

Before implementation planning or repository changes, read and follow
[DEVELOPMENT.md](DEVELOPMENT.md). Follow its task-reading triggers for applicable
development guides and topic documents before choosing an approach; recheck
them when the task expands.

Before planning or implementing new work, search `tasks/` and the relevant
`gaps/` directories. Read and cite matching defects, follow-ups, or plans
before defining new work. Follow [gaps/README.md](gaps/README.md).

Before proposing or reprioritizing work, read the
[Roadmap](docs/roadmap/README.md). Keep its status and blockers current when
roadmap work changes.

For architecture, stability, performance, or security questions, start at
[ARCHITECTURE.md](ARCHITECTURE.md) and its linked topic docs before deriving
an approach.

For UI proposals or mockups, read [UI design](topics/ui-design.md) before
choosing fixtures, rendering, or export commands.

When `AGENT_ARTIFACT_VIEWER_ORIGIN` is set, this session can present images and
documents to the user, so deliver every screenshot, mockup, or generated report
through the repository's artifact capture facility. Writing a file and naming
its path delivers nothing the user can see.
[UI testing](topics/ui-testing.md) owns the commands and the invocations that
silently skip presentation.

The working tree may contain concurrent human or agent edits. Avoid reverting
or tidying unrelated changes unless the task directly requires them.
