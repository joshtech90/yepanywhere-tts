# Artifact CLI tests inherit the launcher's viewer origin

`packages/client/scripts/capture-artifact.test.ts` resets `AGENT_SERVER_URL`
but inherits `AGENT_ARTIFACT_VIEWER_ORIGIN` when spawning its capture CLI.
The latter takes precedence over discovery through the test server, so a
YA-launched test can contact the launcher's service instead of its fixture.

The inherited-URL case failed with `Invalid URL` during the client suite and
passed with the inherited viewer origin unset. Reset that input alongside
`AGENT_SERVER_URL`, then set explicit values only in tests of the announced
origin. Kept outside the measurement fix because this is independent test
isolation, not browser timing behavior.

Found 2026-09-13 while verifying bounded development measurement retention.
