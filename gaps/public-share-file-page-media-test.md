# PublicShareFilePage media test fails after shares expand inline media

`packages/client/src/pages/__tests__/PublicShareFilePage.test.tsx`, case
"uses the shared file viewer and embedded Markdown media", fails
deterministically on `main` at `5744aa7ab` with
`AssertionError: expected <img …(3)></img> to be null`. That commit made
share viewers start with inline media expanded, so an image the test expects
to be absent is now rendered. Either the assertion is stale and should expect
the expanded preview, or the expansion reaches a surface it should not; which
one needs a look at the test's intent. Not fixed in place because it is
unrelated to the work that found it and the intended share behavior is the
owner's call.

Found 2026-10-15 while running `pnpm test` for provider background-work
recording.
