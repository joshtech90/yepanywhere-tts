# Chrome Web Store publication

Version **0.1.1** is **Published — public**, verified on **2026-10-14**, in
all regions. Version **0.1.3** was submitted on **2026-10-14** and is
**Pending review**, with automatic publication after approval. The item is
`dgeameddpnggdeenoekpiaacfghdodch`; [identity.json](identity.json) holds its
public key. Account links and reviewer credentials belong in the private
`dotfiles/runbooks/yepanywhere-chrome-extension.md` inventory.

## Upload package and CI

```sh
pnpm --filter @yep-anywhere/browser-extension package:store
pnpm --filter @yep-anywhere/browser-extension typecheck:acceptance
pnpm --filter @yep-anywhere/browser-extension acceptance --store-assets
pnpm --filter @yep-anywhere/browser-extension acceptance
```

The build includes the complete client, worker and panel. Assembly uses the
extension package's own version, independent of server release tags. It creates
`packages/browser-extension/release/yep-anywhere-chrome-0.1.3.zip`, a checksum
and `build.json` containing the source revision, dirty-state flag, extension id
and file count. The manifest is at the ZIP root. Source maps, inline/remote
HTML scripts, missing entries, wrong icon sizes, an incorrect store key and
unexpected install permissions fail the package audit. ZIP creation requires
Python 3 (`python3`, or `py -3` on Windows); CI runs packaging on Ubuntu.

[Chrome Extension CI](../../../.github/workflows/browser-extension.yml) can be
run manually with mode `package` to produce a package and listing artifact.
New `extension-v<version>` tags submit the verified ZIP to the existing store
item, then create a GitHub release with the ZIP, checksum, build record and
submission receipt. Google still controls review and final publication. The
workflow extracts the actual upload ZIP and runs login, exact lookup, in-place session
opening, reload, saved-login browser restart, settings, sequential typing and
concurrent relay transcript updates. A separate owned-site-grant fixture covers
the automatic badge; its extra permission is never added to the store ZIP.

Upload the inner `yep-anywhere-chrome-*.zip`, not the outer GitHub artifact
container. Use a CI artifact with `sourceDirty: false`. Only the store upload
ZIP updates the existing item; Chrome publishes signed updates after review.
Bump the extension package version for each store update. Existing unpacked
development builds used YA-derived versions; remove the development copy
before installing the store item, and sign into saved hosts again if Chrome
clears that extension's storage.

## Releasing an update

Update and commit `packages/browser-extension/CHANGELOG.md` with a section
such as `## [0.1.4]`. From a clean, current `main` checkout, run:

```sh
scripts/release-extension.sh 0.1.4
```

The helper validates the version and changelog, commits the package version,
and atomically pushes `main` and `extension-v0.1.4`. CI must pass packaging and
both exact-ZIP acceptance gates before it can authenticate and upload. The
publisher checks source revision, checksum and pinned store identity, waits
for upload processing, and submits with review enabled and warnings blocked.
A strictly newer candidate automatically cancels an older pending or staged
submission, waits for cancellation, then uploads and submits the replacement.
Same-version retries are safe, and an older workflow cannot cancel a newer
submission. Publication jobs are serialized and recheck store status after
cancellation. Review is asynchronous: a successful workflow means submission
succeeded, not that Chrome has delivered the update.

Cancellation happens only after the new ZIP passes both CI acceptance gates and
integrity checks. It returns the old candidate to draft; if replacement upload
or submission then fails, rerun the failed publishing job after resolving the
error. The previous public version remains available. Google permits at most
six review cancellations per publisher per day, so a quota error stops the run
without uploading. See [review cancellation](https://developer.chrome.com/docs/webstore/cancel-review)
and the [cancellation API](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/cancelSubmission).

Before tagging, update listing assets/disclosures in the dashboard if behavior
or permissions changed, and verify the existing reviewer host remains usable.
Those account forms are outside the publishing API. Manual uploads remain a
recovery option using the exact clean CI artifact described above.

## One-time publishing configuration

The dedicated `chrome-web-store` GitHub environment holds three variables:
`CWS_WIF_PROVIDER`, `CWS_SERVICE_ACCOUNT`, and `CWS_PUBLISHER_ID`. No private key
or refresh token is stored in GitHub. Enable the Chrome Web Store API in the
Google Cloud project and link the dedicated service-account email in the
Web Store developer account's API access settings. Google grants access at
publisher scope; the script pins the Yep Anywhere item. See
[Google's service-account setup](https://developer.chrome.com/docs/webstore/service-accounts).
The account needs no general project roles. Grant only `roles/iam.workloadIdentityUser` on that account to the
workload pool's exact GitHub environment subject.

The OIDC provider maps `google.subject` to `assertion.sub` and restricts the
immutable repository/owner IDs, the `chrome-web-store` environment subject,
this workflow's exact `workflow_ref`, and either `main` or an `extension-v*`
tag. GitHub environment deployment rules allow only that branch/tag pattern.
Concrete cloud identities and bindings live in the private dotfiles runbook.

Verify the configuration without uploading or submitting anything:

```sh
gh workflow run browser-extension.yml --ref main -f mode=check
```

This main-only job obtains a short-lived scoped token, reads store status,
checks the canonical public key and retains a sanitized status receipt.
[Live verification 38618552980](https://github.com/kzahel/yepanywhere/actions/runs/38618552980) passed on
2026-10-14: the pinned item reports 0.1.1 published and 0.1.3 pending review.
The check made no upload or publication request. Upload/publish transitions
are covered by the publisher tests; the next requested release tag will use
that path against the store.

## Listing assets

| Asset | Dimensions / purpose |
| --- | --- |
| [Store icon](store-icon.png) | 128×128 PNG, existing green Y artwork at 96×96 with transparent 16-pixel padding |
| [Small promotion](small-promo.png) | 440×280, editable [SVG](small-promo.svg) |
| [Marquee promotion](marquee.png) | 1400×560, editable [SVG](marquee.svg), optional |
| [Side panel](screenshots/04-side-panel.png) | 1280×800, actual native Chrome side panel beside public Yep Anywhere issue #123; recommended first screenshot |
| [Session](screenshots/01-session.png) | 1280×800, actual packaged app conversation |
| [Issues](screenshots/02-issues.png) | 1280×800, indexed public issue references |
| [Settings](screenshots/03-settings.png) | 1280×800, site access, repository filters and toolbar behavior |
| [English listing](listing.en-US.txt) | Name, summary, description, category and public URLs |
| [Privacy fields](privacy-disclosures.md) | Single purpose, permission justifications and data categories |
| [Privacy policy](privacy.md) | Public policy for the actual extension behavior |

The app screenshots use a fresh Playwright Chromium profile and an isolated
server with explicitly labeled **Demo** sessions about the real public
[kzahel/yepanywhere#123](https://github.com/kzahel/yepanywhere/issues/123) and
[#121](https://github.com/kzahel/yepanywhere/issues/121). They show actual
packaged UI, not mockups or private transcripts. The native side-panel image
uses Chrome for Testing and Machine Control, cropped to the browser content
bounds and exported at the store's required size. No primary browser profile
is copied. That browser and the fixture servers are closed after capture.

Regenerate the app screenshots with the `--store-assets` acceptance command.
Add `--headed` for the native toolbar/panel capture: it pauses on public issue
#123, records readiness under ignored `tasks/extension-publication/`, and waits
for `headed-done`. Use Machine Control against **Google Chrome for Testing**,
then signal that file. Do not use the primary installed Chrome with a temporary
profile. The native screenshot is a separately inspected asset; headless CI
regenerates the three app screenshots, not the OS-owned side-panel frame.
All captures are presented through the repository artifact capture facility.

The promotion images reuse the existing vector identity; they are branding,
not simulated app screenshots. Regenerate with `rsvg-convert INPUT.svg -o
OUTPUT.png`. Extension icons under `packages/browser-extension/src/icons/`
are rasterizations of `packages/client/public/icon.svg`; only the 128px store
icon uses the required 16px transparent padding.

## Verified CI candidate

[Chrome Extension CI 38604832081](https://github.com/kzahel/yepanywhere/actions/runs/38604832081)
passed its package and acceptance job for source
`8eec474833b94de5349b7e6df27135a776344993`, version **0.1.3**.
The upload ZIP SHA-256 is
`fb0665563af5abfdeeba4538b137f436f84aae49b3c679dc8c992a1a36258cbd`.
The downloaded file's checksum and archive integrity were verified, and its
build record declares `sourceDirty: false`. Linux exact-ZIP acceptance measured
16.0 ms maximum for 35 keys; the separate badge fixture measured 15.0 ms.
Both pass the unchanged 100 ms input limit with concurrent transcript updates.
The downloaded CI ZIP also signs into the existing isolated reviewer host
through its public TLS relay from a fresh, subsequently removed profile.
Saved login also survives a complete browser restart. The unpublished 0.1.2
candidate exposed a stale-route acceptance race; 0.1.3 waits for the current
session route without changing the timeout or application behavior.

## Store submission

The original 0.1.1 CI ZIP replaced the registration seed. The console has
saved [English listing](listing.en-US.txt), the icon, both promotion images,
and all four screenshots in the documented order (side panel first). The
official site is `yepanywhere.com`, with the homepage and GitHub support links.
Distribution is **Public**, **Free of charge**, and **All regions**.

The privacy fields and six data categories are saved. The console exposes
justifications for all four install permissions, including `contextMenus`;
the optional per-site host access explanation is included with `activeTab`.
The existing isolated
evaluation-server login and owner-login steps are saved in the restricted
Test instructions fields, never in public artifacts. Login was rechecked with
the exact CI ZIP before submission. Keep that server available during review.

The maintainer authorized submission, and the console confirmed it on
2026-10-13 with **Publish automatically after review** enabled. Version 0.1.1
is now public. The exact 0.1.3 CI ZIP was uploaded and submitted on 2026-10-14
after saving its `contextMenus` justification. The console confirmed submission
and reports **Pending review**; automatic publication after approval is enabled.
For later updates, refresh the package, listing and disclosures, verify
reviewer access, then submit the new extension version.

Asset requirements were checked against [Chrome's image specifications](https://developer.chrome.com/docs/webstore/images): 128px icon, required 440×280 tile, optional 1400×560 marquee, and full-bleed 1280×800 screenshots.
