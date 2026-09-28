# The UI-testing launch recipe's provider-host directory overflows the socket path limit

`topics/ui-testing.md` § Browser capture command tells a capture run to put
its private provider-host runtime directory under the checkout:
`YEP_PROVIDER_HOST_RUNTIME_DIR="$UI_DIR/host"` with
`UI_DIR="$PWD/.artifacts/ui-testing/<timestamp>"`. In a checkout at an
ordinary depth that path plus `provider-<hex>.sock` exceeds the 107-byte Unix
socket limit, and `pnpm dev` exits at startup from
`assertProviderSocketPath` (`scripts/provider-process-identity.mjs`):
"Provider host socket path exceeds 107 bytes". Observed with
`/local/graehl/yepanywhere/.artifacts/ui-testing/20260926-f24-margin-navigation/host`.

Not fixed in place: found while fixing harsh-review item F24, whose handoff
scopes each pass to one item.

Cheap fix: make the recipe create a short private directory instead, for
example `HOST_DIR=$(mktemp -d "${XDG_RUNTIME_DIR:-/tmp}/ya-ui.XXXXXX")`
(mktemp creates it mode 700), pass that as `YEP_PROVIDER_HOST_RUNTIME_DIR`,
and remove it after teardown. Keep the data directory under `$UI_DIR`.

Found 2026-09-26 while capturing the Appearance setting for F24.
