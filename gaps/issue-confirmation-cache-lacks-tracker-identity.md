# Tracker confirmation cache omits the tracker site

`issue_confirmations` is keyed by project, provider and reference key, without
the tracker host/context path. `IssueConfirmer.request` resolves Jira keys
against the currently configured site, while `IssueStore.list` associates
confirmation facts by reference key across projects. Two Jira sites can hold
the same key; changing the configured site also leaves prior verdicts without
the origin needed to distinguish them. GitHub Enterprise references likewise
must not inherit facts fetched from github.com solely by repository/number.

The existing confirmation response therefore cannot establish canonical
tracker identity for every stored title or verdict. This predates searchable
confirmation subjects. The subject-search stage preserves the confirmation
cache's existing association model; it does not resolve this ambiguity.

Fix the acquisition/storage owner by persisting the canonical identity and
fetch origin with each receipt. Do not silently treat ambiguous legacy rows
as site-qualified facts. Include migration/reacquisition and same-key,
different-host regression cases in the
[content acquisition stage](../topics/issue-session-associations.sketches.md).
That stage owns the schema change; the current slice adds no acquisition or
schema behavior.

Found 2026-10-21 while adding cached-subject search.
Contributing-model: gpt-6-astra
