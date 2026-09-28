# Local conversation preview intermittently stays "connecting"

`packages/client/e2e/local-conversation-preview.spec.ts` waits for
`preview-source` to reach `data-source-status="ready"` under the default
5000ms expect budget (lines 73 and 109). The source sometimes stays
`connecting` past that limit, and which variant fails varies:

- 2026-09-28, full `pnpm test:e2e` (post-publication check for 089aebaa5):
  `cookie auth=true` failed, 320 other tests passed.
- The same day, the spec rerun alone: `cookie auth=true` passed (10.5s) and
  `cookie auth=false` failed at the same assertion.

Two variants failing on alternate runs of an unchanged tree points to timing,
not to one auth path. Whether the connection is merely slow under load or
occasionally never completes is not established. Per
[test time budgets](../topics/test-time-budgets.md), read the failing run's
trace (`test-results/.../trace.zip`) to see whether the local HTTP/SSE source
ever connects before deciding between a measured budget and a connection fix.
Related but distinct: [experimental preview refresh](experimental-preview-refresh-disconnect.md).

Found 2026-09-28 while publishing.
