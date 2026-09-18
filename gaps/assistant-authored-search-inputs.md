# Assistant search omits authored commands and edit additions

Proposed extension: ordinary in-session C-s and All Sessions Ass. search
should include assistant-authored command strings and Edit/Add/Write additions,
alongside assistant prose. Neither currently includes tool inputs in this
scope. Keep the two search surfaces consistent; full-session search is a
separate, broader scope and is not the template for this extension.

Include commands passed to execution tools, explicit grep/search operation
needles or query strings, replacement/new text from edits, added patch lines,
and content authored by Add/Write operations. Authored document prose is a
primary motivation; commands and search needles can also contain useful terms.
Exclude old
replacement text, removed and context patch lines, baseline/read file contents,
command/tool output, reasoning, and image/media payloads. Do not stringify
arbitrary tool arguments: select provider-normalized input fields explicitly.

The owning paths are `packages/client/src/lib/sessionDetail/search.ts` and
the bounded All Sessions extraction path in
`packages/server/src/sessions/issue-text-reader.ts`. Its current
`normalizeIssueEntries` / `visibleIssueText` projection is also used by the
issue index; do not silently broaden that index's independent contract.
Share the eligible authored-text projection, preserve original message/tool
IDs for navigation and Zoom, and test command-output/image exclusion as well
as positive command, grep/search-query, replacement, and patch-addition examples. Older servers
must continue advertising their actual narrower coverage.

This remains separate from the UI landing and from the oversized-record
classification defect in [the index gap](all-sessions-search-index.md).
The current contract is [All Sessions search](../topics/all-session-content-search.md).

Found 2026-09-15 while clarifying the requested assistant search scope.
