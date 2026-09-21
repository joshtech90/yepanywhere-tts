# Let an app be fetched publicly with optional visitor identity

Every vhost app today is reached either with a bearer URL (`ya_access`
token, then cookie) or through the row's explicit **Public — no link
required** flag, which is anonymous. There is no middle setting: "anyone may
load this bundle, and if they sign in with an identity provider, tell the
app who they are".

This is about fetching the bundle in the browser at all, not the app's own
accounts. An app remains free to run its own login, accounts, and
authorization behind that first fetch; YA neither replaces nor mandates that.

Sketch:

- A third access mode on the Apps row beside bearer and public:
  **public with identity**. Visitors without a session load the app as
  today's public mode does.
- An optional OAuth/OIDC provider configured once at server level (GitHub
  first, since provider tokens are already a known shape in
  `topics/copilot-provider.md`). A visitor may sign in; the callback lands on
  the isolated app origin, never the YA origin, and sets a host-only cookie
  for that app.
- The proxy forwards the verified identity to the loopback app as a header
  (`x-ya-user`, plus provider and subject), stripped from incoming requests
  so an app cannot be spoofed by a visitor setting it. Anonymous visitors get
  no header.
- Optionally, a row may require identity (any signed-in visitor, or an
  allowlist), which is the point where this meets
  `topics/limited-users.md` membership.

Constraints carried over from `topics/active-content-security.md`: no YA API
on the app origin, no YA cookies forwarded, the app-scoped bearer remains the
default, and enabling this is a per-row explicit choice. The existing gap
`gaps/app-artifact-access-control.md` states URL possession is intentionally
the authorization unit for bearer mode; this sketch adds a mode, it does not
replace that one.

Found 2026-09-19 while drafting the limited-users proposal.
