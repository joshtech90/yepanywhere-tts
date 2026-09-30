# A limited login ends into the owner's desktop session

A browser can hold two YA credentials at once: the owner's desktop session
cookie (`yep-anywhere-desktop-session`, accepted before any password check in
`packages/server/src/middleware/auth.ts`) and a limited user's login cookie.
While the limited login is valid, the limited-users middleware resolves the
limited user. When it stops being valid — logout, expiry, a password change,
the user's deletion, or a lost `auth.json` — `AuthService.getSessionUsername`
returns null, the desktop session still authenticates the request, and
`resolvePrincipal` reads null as the superuser. The browser silently becomes
the owner with no login prompt.

Observed 2026-09-28: archer's Chrome profile at `127.0.0.1:3400` had the
owner's desktop session; after `auth.json` was lost (fixed separately:
it now fails closed) that tab had full owner access.

Fix the invariant: a browser that signed in as a limited user must not reach
owner authority without the owner signing in. Candidates: clear the desktop
session cookie when a limited user signs in on that browser, or record a
limited sign-in (a signed, non-secret marker cookie) that the middleware
honors after the login ends, answering 401 so the limited user signs in again
and only the owner's explicit logout of it restores owner access. Cover
logout, expiry and deletion in an app-level test with a desktop session
present.

Found 2026-09-28 while diagnosing a limited user's browser showing the
owner's sessions.
