# Provider Sign-In

> Provider sign-in lets the server owner authenticate the host's Claude or
> Codex CLI from Settings → Providers, either through a server-run login whose
> link and codes YA relays to any browser, or in a terminal opened on the
> server's desktop, alongside the copyable login command.

Topic: provider-sign-in

## Surfaces

When Claude or Codex is installed but not authenticated, its Providers card
shows three equivalent routes to the same provider-owned login:

- **Copy login command.** `loginCommand` names the runtime YA actually
  resolved, which on Windows and in the desktop app is often not on `PATH`.
  On Windows a path that needs no quoting is emitted bare, so the command runs
  unchanged in both cmd.exe and PowerShell; a path that needs quoting uses
  PowerShell's `& "…"` call form. `formatExecutableInvocation` owns that rule.
- **Sign in** runs the login on the server without a terminal and relays it.
- **Open in a terminal on the server** opens a visible console on the
  server's own desktop running the interactive login. It is offered only where
  the server can open one: Windows (a new `cmd /k` console that stays open
  after the CLI exits) and macOS (Terminal through `osascript`). Other hosts
  omit the button.

The server reports `supportsInAppLogin` and `supportsHostTerminalLogin` per
provider in the provider catalog. Older servers omit both, and the client
shows only the copy panel. No global capability is allocated: the provider
payload itself carries the gate.

## Relayed sign-in

The relayed sign-in uses the same executable and environment the provider's
sessions use (Codex: its configured path and `CODEX_HOME`):

- Codex runs `codex login --device-auth`. YA shows the device page link and
  the one-time code; the CLI completes on its own once the user approves in
  any browser. The default browser login is not used because its callback is
  on the server's localhost.
- Claude runs `claude auth login --claudeai`. Without a terminal it prints an
  authorization link whose page displays a code; YA shows the link and a code
  field, and writes the submitted code to the CLI's stdin.

`/api/providers/:name/login` exposes the flow: `POST` starts one, `GET` reads
the current or recently finished one, `POST …/login/code` submits a code, and
`DELETE ?flowId=` cancels. `POST …/login/terminal` opens the host terminal.
Flow output is shown with terminal control sequences removed.

At most one flow runs per provider; starting another cancels the first. Every
flow ends within 15 minutes, matching the Codex code lifetime, and its CLI
process tree is terminated on cancel, expiry, or replacement. A finished flow
stays readable for five minutes so a polling client sees how it ended. The
client polls only while a flow is running and stops when the panel unmounts.
A client that opens the panel while a flow is running, including after a
layout change or from another device, resumes that flow. Success refreshes
the provider catalog so the card reflects the new authentication state.

## Authorization

Sign-in signs the host's CLI into an account, so it is owner-only. Limited
users are refused every `/api/providers/:name/login` route, including the
status read, because a live device code would sign the host into whichever
account enters it.
