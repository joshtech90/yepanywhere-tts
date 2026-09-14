# Bun Vitest source loader cannot collect shared Zod schemas

Bun 1.3.14 running Vitest 2.1.9 with the server's source conditions fails
collection for `test/process.lifecycle.test.ts` and
`test/augments/safe-markdown.test.ts` with:

```text
TypeError: undefined is not an object (evaluating 'z.string')
packages/shared/src/security-clients.ts:32
```

The storage test collects and passes. The same dependency graph works through
Bun's production ESM loader: fresh npm CLI/HTTP/WebSocket startup, installed
renderer and provider-owned child shell/CLI probes pass. Do not label Node-run
Vitest as Bun runtime evidence, or alter production schema imports just to
accommodate this source-loader failure. Investigate a supported Bun/Vitest VM
loader configuration separately; a framework upgrade needs its own broad suite
validation. The cutover uses compiled artifact probes in addition to Node tests.

Reproduce from `packages/server` with the pinned Bun executable:
`bun x --bun --no-install vitest run test/process.lifecycle.test.ts test/augments/safe-markdown.test.ts`.

Found 2026-09-08 during the immediate server runtime cutover.
