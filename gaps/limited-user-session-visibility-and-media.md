# Limited users cannot reliably list their sessions or view their images

The maintainer reported both failures for `archer` on 2026-09-28 after creating
the scooter-parkour project from App canvas. These are separate failures:

- The session body is visible, but the header shows “Not permitted for this
  user” and the sidebar remains at “Loading sessions…”. The exact failing
  request has not been identified. Do not interpret this as evidence that
  every session-detail read is denied. Trace direct and relay list requests,
  ownership filtering and auxiliary sidebar requests. The limited-user
  contract promises continued read access to sessions the user started even
  after a project grant is removed; the middleware list projection currently
  filters by project grants, while individual reads also recognize ownership.
- The session's explored-image strip shows “Image unavailable” for
  `/tmp/sp-prep/desktop.png`, `phone.png`, `brand.png` and `brand2.png`.
  `ExploredImageStrip` requests the host-wide `/api/local-image` route, which
  `limitedUserPolicy.ts` explicitly denies. The sandbox's `/tmp` also differs
  from host `/tmp`, so merely allowing that route is not a fix. Serve media
  through a session-authorized reference and the correct sandbox/storage
  location; preserve denial of arbitrary host-file reads through the API.

Related contract: [limited users](../topics/limited-users.md). Verify the real
limited-user browser path, image thumbnails and modal viewing, reload after
the provider stops, and denial for another user's ungranted session. Existing
session media routes are the first reuse candidate; do not create a global
file-access exception to satisfy this screenshot.

Captured alongside the Canvas template conversation change; these failures
are not fixed by changing the template prompt or source replica.

Found 2026-09-28. Contributing-model: 6-Astra.
