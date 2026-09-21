# Template retrieval needs a complete, selectively fetched source subset

Remote acquisition now uses shallow Git checkouts with complete repository
contents, followed by private translated copies. Downloading only
`project-templates/` would miss referenced sibling topics, skills or other
resources. This gap tracks the requested efficient retrieval separately from
[runtime stand-up](project-template-standup.md).

The configurable default is repository `https://github.com/graehl/agents`,
content root `project-templates`, with support for a specified revision and
alternative sources. It does not depend on the host's `~/agents`. Retrieve
when the feature is enabled and when its configured origin changes while
enabled. Origin includes repository, content root and revision for source
invalidation. Save changes while disabled without fetching; validate the
current source on enable before making it available. Cache outside YA's source
checkout; this does not require a YA Git submodule.

## Intended retrieval

The current cache retains prior successful and failed staging directories.
Add explicit bounded retention before frequent updates: preserve the admitted
snapshot and any in-use creation inputs, and reclaim only cache-owned paths.
Selective transfer alone does not bound accumulated local storage.

- Resolve the selected ref once to an immutable commit. Fetch the configured
  GitHub path's tree and contents, then selectively fetch referenced paths and
  symlink targets, transitively, from that same commit. Do not mix a moving
  branch's revisions or resolve remote links against the host filesystem.
- Follow the manifest graph and explicit resource dependencies as well as
  symlinks. The agents refactor must expose a discoverable dependency boundary;
  arbitrary Markdown link crawling is not a substitute for that contract.
- Permit relative links into sibling repository paths. Reject missing targets,
  cycles, repository escapes and Git-private metadata; preserve required bytes
  and executable modes. Deduplicate repeated targets and bound traversal.
- Validate the complete inventory, referenced resources and compositions before
  admitting the snapshot. Report incomplete retrieval as an error, never a
  partial successful library. Configuration changes must not reuse another
  origin's cached content or broaden saved source-qualified template grants.
- Materialize ordinary copied files into created projects, with every required
  resource included. No later build/test/run or supported add-on may require
  either the cache or the author's checkout.

The producer-side prerequisite is
`~/agents/project-templates/gaps/template-content-subset.md` (repository
`graehl/agents`, same repository-relative path). It owns the intuitive content
layout, possible symlink entry paths and linkage to task-suitability review.
Choose Git partial retrieval or another GitHub tree/blob mechanism during
implementation; do not confuse sparse working-tree paths with avoided blob
downloads, or claim reduced transfer merely because fewer files are checked out.

## Closure evidence

At a fixed revision, compare selective retrieval with a full clone for all
three templates: identical composed bytes/modes and complete resource closure.
Record fetched paths and transferred content to show unrelated repository
blobs were not downloaded. Cover nested/shared symlinks, cycles, escapes,
missing resources, interrupted retrieval and a branch moving mid-fetch.
Verify disabled configuration changes cause no retrieval, enabling uses the
current origin, and an enabled origin change fetches and validates its own
snapshot. Repeat with a different repository/subdirectory/revision.

Found 2026-09-21 during user clarification of configurable template sources
and efficient dependency retrieval. Contributing-model: 6-Astra.
