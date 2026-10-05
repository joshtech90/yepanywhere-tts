# Native sudo

Topic: `native-sudo`

Status: opt-in local Mac launch integration implemented; signed assembled-app
verification and ARM64 native helper conformance pass. Public release and a
model-driven YA tool turn remain open.

## Current

Set `YEP_MC_SUDO_APP` to the installed Machine Control app and
`YEP_MC_SUDO_TEAM_ID` to the publisher team ID obtained from a trusted source.
Do not infer a trusted publisher from an arbitrary downloaded app. Restart YA
and its shared provider host after changing their launch environment.

Before launching an eligible agent, YA checks the complete app signature and
both native executable signatures against the independent publisher and exact
identifiers. Missing publisher or failed integrity verification refuses that
configured launch. The native helper path is prepended to the agent PATH, and
an exact shell-quoted path is supplied in global instructions. Existing
instructions, environment and self-session grants are preserved.

This applies to local unrestricted Codex (`bypassPermissions`) and local Claude
providers. It is not advertised to remote executors, plan sessions, session
sandboxes or Codex modes whose sandbox could prevent the native connection.
With no opt-in, launch options are unchanged and no verification runs. There
are no client fields, new routes, provider protocol changes or new YA tokens.

## Decision

YA coordinates agent context; [Machine Control's native helper](../../machine-control/platforms/macos/sudo/README.md)
owns the local password field and system sudo route. The person authenticates
one command in an AppKit dialog on the agent's Mac. The password never reaches
YA, chat, arguments, environment, logs, WebView or an agent tool. Instructions
require waiting for the bounded prompt and prohibit automatic retries after
cancellation, timeout or authentication failure.

The helper displays command arguments, working directory and observed process
ancestry. The authenticated command and descendants can retain root authority.
No session grant or default passwordless sudo setting is created. Existing OS
NOPASSWD policy remains authoritative. Same-user shell access is not contained.
Desktop control arming does not imply administrator authorization. A remote YA
browser cannot authenticate a local native prompt through this integration.

## Validation and open work

Eighteen touched-area launch/self-session tests pass, covering disabled
defaults, eligibility, preserved context, trusted-path injection and configured
integrity failures. Full lint, format and typecheck pass. The signed assembled
app probe passes publisher/integrity verification and rejects a wrong trusted
publisher, modified helper and incomplete helper pair. Native helpers pass
real password, cancellation, timeout, concurrent prompts, process termination,
root UID and root-file effect conformance in the claimed ARM64 appliance.
No password reaches captured process output and no new sudo cache is created. Machine Control owns
signed packaging and real sudo/native-dialog acceptance in its dedicated Mac
appliance. Public release, physical-workstation acceptance, Touch ID,
process/session leases and other operating systems remain separate work.

## Shared installation discovery

[The desktop consumer](../docs/tactical/142-machine-control-desktop-consumer.md)
now shares the Mac app signature verifier. Existing `YEP_MC_SUDO_APP` and
`YEP_MC_SUDO_TEAM_ID` remain authoritative when supplied. Alternatively,
`YEP_MC_SUDO=1` selects `YEP_MC_APP` (or the standard Mac app location) and
`YEP_MC_TEAM_ID`. `YEP_MC_CONTROL=1` does not select sudo. The sudo feature still
verifies both native helpers independently; an older app with those helpers
need not have the new control CLI. Sharing a locator does not merge feature
opt-ins, eligibility or authentication authority.

## Related hardening gap

[Native exec privilege hardening](../gaps/native-server-no-new-privs.md) remains
open. This opt-in intentionally uses an OS privilege transition; it does not
resolve that separate containment policy. Its future operator escape hatch
must account for native administrator authentication without changing vanilla
launch defaults implicitly.

Run `pnpm exec tsx --conditions source scripts/probe-native-sudo.ts --app APP
--team-id TRUSTED_TEAM` on a Mac to verify a signed assembled app, launch
advertisement, and wrong-publisher, modified-helper and missing-helper refusal.
The probe launches no agent provider or elevated command.
