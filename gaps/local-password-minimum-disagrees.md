# Local password minimum disagrees between the login page and everything else

The server (`packages/server/src/auth/routes.ts` `/enable`, `/setup`,
`/change-password`), Settings → Local Access, and `yepanywhere --setup-auth`
all accept a local password of 6 characters. The login page's first-run setup
form (`packages/client/src/pages/LoginPage.tsx` `handleSubmit`) refuses
anything under 8 with `loginErrorPasswordTooShort`, whose text says 8 in `en`
and five translated locales. The user docs state 6.

Not fixed in place: choosing one minimum is a product decision, and lowering
the client check means correcting the translated strings, which
`docs/development/client.md` leaves to the maintainers' locale pass. The Remote
Access password check (`RemoteAccessSetup.tsx`, 8) is a separate credential
and may legitimately differ.

Cheap fix: pick the minimum, make `LoginPage.tsx` and the server agree, and
correct `loginErrorPasswordTooShort` in `en.json` (other locales follow in
the batch update).

Found 2026-09-28 while documenting local access passwords.
