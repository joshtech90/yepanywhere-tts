# MCP App typing intermittently restores text after clearing

The 2026-10-26 publish browser check failed the phone case in
`packages/client/e2e/mcp-app-view.spec.ts`: after inserting "Plan a trip to
Oslo" and clearing the composer, the first sequential key produced
"Plan a trip to OsloS" instead of "S". The unchanged test passed in the
focused reproduction and all six cases of a three-repeat spec run. Both
source CI browser shards also passed on the published revision.

The cause remains unproved. Investigate pending controlled-input commits and
draft synchronization around programmatic insertion followed by clearing.
Retain the 100 ms per-key assertion; passing focused runs do not resolve the
observed overwrite.

Found 2026-10-26 while repairing the latest publish failures.
Contributing-model: 6.1-Sol.
