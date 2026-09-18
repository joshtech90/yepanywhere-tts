# App-link expiry and browser coverage

Private-by-default vhost bearer access, explicit Public access, durable signing
and revocation, and Apps settings link controls are implemented. The contract
and process-restart test are in
[active-content security](../topics/active-content-security.md#private-app-links).
Existing artifact/public-share URLs retain their persisted formats.

Remaining work:

- Optional app-link expiry and a link inventory modeled on public-share
  management; current app revocation invalidates all links for that app.
- Embedded-cookie restrictions: Chromium localhost top-level and iframe
  assets are tested. Verify public HTTPS embedding, blocked third-party
  cookies, Safari/WebKit and Firefox. Provide an explicit detected failure
  explanation where feasible; the existing move-out/new-tab controls allow
  opening the signed URL at top level. Do not weaken authorization to recover.
  Plannotator 0.27.15 reproduces repeated onboarding when embedded from a
  different site: its browser cookie writer uses `SameSite=Lax`, and its
  look-choice and terminal-announcement gates read only those cookies.
  Matching release source and installed CLI help expose no environment or
  command-line onboarding override. A Chromium localhost iframe probe rejects
  the Lax preference but retains `SameSite=None; Secure; Partitioned` across
  reload. YA already permits same-origin storage inside the isolated frame;
  another sandbox permission does not change the app's cookie attributes.
  Resolve app preference persistence without weakening origin isolation or
  rewriting third-party JavaScript. Plannotator source remains unchanged.
- Existing mounted sessions can retain a revoked launch URL until reload;
  propagate link-generation invalidation through the source's retained state.
- Artifact inventory/manual revocation remains in
  [its existing gap](artifact-grant-revocation-ui.md). Artifact Public visibility
  is deferred; existing long random artifact URLs already act as access grants.
- WebSocket vhost proxy support is absent: authorized upgrades return 501,
  unauthorized ones 401. Any future implementation must use the same gate and
  close active connections on expiry/revocation.

URL possession intentionally grants access; do not replace this with
login-bound or single-use credentials. Apps lifecycle must not delete unknown
working datasets.

Found 2026-09-16 while implementing bearer-link access for Apps settings.
