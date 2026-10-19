# 154 — Watched extension development builds

Status: implemented and locally verified 2026-10-16. Commit requested; no publish.

Kyle requested automatic extension builds separate from release `dist`, plus a
bottom-right side-panel control indicating a newer build and applying it with
as little panel closing as Chrome permits. This extends
[151](151-chrome-extension-client.md). Searching `tasks/` and `gaps/` found no
existing extension-watch plan; the adjacent
[wrapper process-group test gap](../../gaps/dev-wrapper-process-group-reap-untested.md)
concerns provider shutdown, outside this feature.

1. Add opt-in `pnpm dev --extension` and standalone extension `dev`, both
   owning the same debounced coordinator and ignored `dist-dev` output.
2. Build UI, worker and manifest into staging; publish completed generations
   only, preserve the prior output on compilation failure, retain two asset
   generations, and prevent concurrent owners. Own and release watchers and
   compiler children alongside the dev wrapper.
3. Add dev-only build metadata and footer. Check packaged metadata only while
   visible, apply UI-only updates through page refresh to preserve the native
   panel, and use runtime reload for worker/manifest changes. Try a one-shot
   reopen; explain Chrome's fresh-gesture restriction and preserve a toolbar
   fallback. Production output has no dev metadata/control/worker hook.
4. Keep existing extension identity, permissions and server contracts. Test
   with owned browser/data profiles, actual source watch and reload, desktop
   and phone captures, serialized build/failure races and wrapper shutdown.
   Run required lint, format, typecheck, tests and release package audit.

The durable behavior lives in
[trusted client packaging](../../topics/trusted-client-packaging.md#chrome-extension-development-build)
and the developer commands in
[local development](../development/local-development.md).

## Verification — 2026-10-16

- Real source-watch acceptance passed in fresh headed and headless Chromium
  profiles. UI refresh changed the embedded generation without restarting the
  worker. Worker mismatch invoked `runtime.reload()`, replaced the worker and
  consumed the one-shot restoration request. Chrome's own Developer mode
  toggle must be enabled in the test profile; initial command-line loading
  alone permits startup but Chrome blocks the extension after a runtime reload.
- Machine Control opened the actual native side panel, verified the footer at
  its bottom right, and kept it open across panel refresh. Full automatic panel
  restoration remains best effort under Chrome's gesture requirement.
- An isolated `scripts/dev.js --extension` instance built the extension,
  served its own version API, and removed the watcher and ownership lock at
  shutdown. Real build coordinator tests passed alongside the portable wrapper
  lifecycle regression (two tests, 4.59 seconds). Controlled races cover dirty
  builds, failure preservation, two-generation asset retention and competing
  output owners, including an explicit path alias of the default output.
- Standalone YA/relay/profile extension acceptance passed with the development
  output: cached merge persistence across server restart, settings/cache
  controls, merged sections, saved login, session navigation, popup reuse and
  badges. All 35 sequential composer keys appeared, maximum 8.0 ms, during
  concurrent relay transcript updates.
- Lint, format, root typecheck, strict extension-acceptance typecheck, touched
  CSS ownership and console scan passed. Release build/package audit passed;
  release scripts have no development signal, footer or worker reload hooks,
  and the package audit now refuses development manifests/signals.
- Root tests passed shared 962, relay 136, push broker 45 and 6,576 server
  cases, with 67 skipped. One unrelated glossary callback-count case failed
  (four scans instead of three), then its focused file passed all 20 cases;
  tracked in [the glossary test gap](../../gaps/project-glossary-snapshot-barrier-test-flaky.md).
  The client suite separately passed all 6,979 cases. No glossary code changed.
- Reviewed desktop 1000×600 and phone 375×812 captures, both the update prompt
  and footer alongside a long PR list. The control remains reachable and rows
  wrap cleanly. Captures were presented through the repository facility.
  Evidence: `.artifacts/extension-dev-*-acceptance.log`,
  `.artifacts/extension-dev-wrapper.log`, `.artifacts/extension-dev-tests.log`,
  `.artifacts/extension-dev-update-{1000,375}.png`,
  `.artifacts/extension-dev-native-after-refresh.png`, and
  `.artifacts/extension-acceptance/smoke/github-panel-{1000,375}.png`.
