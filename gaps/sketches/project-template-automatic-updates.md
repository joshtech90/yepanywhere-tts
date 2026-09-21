# Optional checks for floating template revisions

User-requested sketch, 2026-09-21; not an approved automatic-update feature.
Manual Fetch / update resolves configured refs and reports an unchanged SHA
without downloading repository contents again. `HEAD` means the default branch
tip at that explicit update, not a continuously moving admitted snapshot.

Consider a cheap remote-ref check when entering From template for sources set
to `HEAD` or a branch. Usually the SHA would be unchanged, requiring no content
download. Decide whether a changed SHA should merely offer Update or fetch
automatically; weigh latency, offline behavior, rate limits and silently
changing setup code or community base dependencies. Never mix revisions during
validation or creation, and never change a pinned commit automatically.

The user is unsure this is useful. Keep it separate from the implemented
manual source-management UI and require a product decision before enabling it.
See [project templates](../../topics/project-templates.md).

Contributing-model: 6-Astra.
