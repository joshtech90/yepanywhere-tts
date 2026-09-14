# Public-share revoke test does not reach the expected empty state

The unchanged `SessionShareModal` test `revokes one opaque managed link`
calls the revoke API successfully, then fails to find
`No matching public links.`. The rendered modal still contains a share row.
It reproduces both in `pnpm test` and independently:

```sh
pnpm --filter @yep-anywhere/client test src/components/__tests__/SessionShareModal.test.tsx
```

The other 32 tests in the file pass. Check whether the mocked management-list
response needs to reflect the completed revocation or whether the component
is restoring a stale row after refresh. Do not weaken the removal assertion
without checking the public-share contract.

No client or public-share code is changed by the clone fix. The distinction
between a stale fixture and a real revocation-refresh defect remains open,
so this was not folded into the unrelated fork-discovery implementation.

Found 2026-09-09 while validating immediate Codex/Pi clone discovery on the
checkout based on `2c03afe5f`.
