# Chromium artifact screenshot capture can fail transiently

`packages/client/scripts/artifact-capture.test.ts` failed in the full unit
suite at `captures a standalone bundle in both standard sizes without YA`.
Chromium reported `Page.captureScreenshot: Unable to capture screenshot`
from `captureArtifact` in `packages/client/scripts/artifact-capture.ts`.

An isolated retry passed all 22 tests, and the subsequent full suite passed.
The failure occurred while other verification checks ran concurrently; that
does not establish contention as its cause. Preserve browser diagnostics on
the next occurrence before choosing a fix. No retry or suppression was added.
The utility was outside the hosted-vhost OAuth implementation scope.

A second case in the same file failed once in a full `pnpm test` on
2026-10-14: `revokes a created grant when the interaction fails without
writing a successful manifest` saw no grant `DELETE` request
(`artifact-capture.test.ts:297`). Three isolated runs of the file then
passed. Both failures appear only under the full suite's load.

Found 2026-10-09 while validating hosted-vhost OAuth.
Contributing-model: 6-Astra
