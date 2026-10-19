# Chrome extension side panel and options proposal

Review-only fixture for the side panel and options described in steps 7–10 of
[plan 151](../../../../docs/tactical/151-chrome-extension-client.md).
The maintainer asked for a UI sketch on 2026-10-13. It reuses YA's theme,
`SettingsSection`, `SettingsItem`, the status and provider badges and the
Issues page's type badge; the browser frame, GitHub page and settings
navigation are illustrative. It makes no host, relay, Chrome or permission
requests. Clicks show local feedback, and reload resets all state.

Four views:

- **Panel · on a PR.** The current tab's PR, then one row per session across
  active hosts: title and age, live state, provider, project and host, the
  latest agent activity, and how the session mentions the PR. Clicking a row
  opens that session in the existing YA tab. A new-session action targets a
  project guessed from the repository. The toolbar badge shows the match
  count.
- **Panel · site not enabled.** On a site without granted host access: a
  one-off lookup using the click, or the request for automatic lookup.
- **Panel · other page.** No issue or PR in the tab, so the panel shows
  sessions that need you, running sessions and recent ones; the badge shows
  the attention count.
- **Options.** A **Browser extension** pane in YA Settings: active and default
  hosts with a connection policy each, automatic lookup with per-site access,
  a repository/project allowlist, toolbar and badge behavior, and host-list
  sync.

At 375 px the panel views drop the illustrative page and show the panel alone,
which approximates the side panel's width.

## Build and capture

From the repository root:

```sh
pnpm --filter @yep-anywhere/client exec tsc -p mockups/extension-side-panel/tsconfig.json
pnpm --filter @yep-anywhere/client exec vite build --config mockups/extension-side-panel/vite.config.ts
pnpm exec tsx packages/client/mockups/extension-side-panel/capture.mts pr
pnpm exec tsx packages/client/mockups/extension-side-panel/capture.mts off
pnpm exec tsx packages/client/mockups/extension-side-panel/capture.mts elsewhere
pnpm exec tsx packages/client/mockups/extension-side-panel/capture.mts options
```

Open `.artifacts/mockups/extension-side-panel/index.html` in YA's file viewer.
Captures use the artifact facility at 1000×600 and 375×812, plus a 1000×900
desktop still and a full-page phone image. The workflow opens a session row,
requests site access, checks the attention groups, types into the allowlist
one key at a time (each within 100 ms), activates a host and checks for
horizontal overflow.
