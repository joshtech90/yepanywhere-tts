# Transparent provider subscription switching

Aspiration: YA manages which subscription (ChatGPT account for Codex) a
provider home is logged into, instead of the user doing it at a shell.

## Current manual flow

Switching the Codex account in `~/.codex` today is done outside YA:

```bash
pkill -f ChatGPT; pkill -f codex    # untested whether this is required
rm -f ~/.codex/auth.json
codex logout
codex login --device-auth
codex login status
```

The device-auth step prints a URL and one-time code that must be carried to a
browser. YA could present that URL and code as a tappable link, which is easier
than a terminal, especially from a phone.

## Directions

- **Login switching inside one home.** YA runs the official
  `codex login --device-auth` for a provider home and shows the
  device-authorization link and code. It then reports the resulting account
  from `codex login status`. The official CLI still owns the credentials, which
  keeps this within
  [tactical 133](../../docs/tactical/133-provider-profile-directories.md)'s
  rule that YA never reads, copies or rotates credentials. The pinned Codex
  app-server protocol has no login request (checked 2026-09-30), so this goes
  through the CLI.
- **Continuing sessions across a switch.** A Codex thread's rollout stays in
  its home, so a session may be resumable under the newly logged-in account.
  First, check whether live app-server processes must be stopped, as the
  `pkill` above assumes. Also check how YA should mark sessions whose turns
  ran under different accounts.
- **Per-subscription capability flags.** Record, per account, facts that are
  known in advance, above all Cyber Access Program enrollment and which
  program applies. Then a turn requests a program only where the account is
  known to hold it. Today the program is one server-wide setting. A turn that
  a non-enrolled account rejects is retried without the program, and that
  account and model are skipped afterwards
  ([Codex sessions § Per-Turn Cyber Access Program](../../topics/codex-sessions.md#per-turn-cyber-access-program)).
  With flags recorded in advance, even the first rejected attempt would be
  avoided.

Relation to tactical 133: profile directories give each account its own home,
which suits concurrent sessions on different accounts. This sketch covers
switching the account of an existing home, the flow in use now. The two
compose, since a profile directory could also offer device-auth login. The
user would consider moving to a strict one-home-per-account setup if that
gives the better UX. Under that setup, account identity is the home path,
and per-subscription flags could key on it. The case for keeping one shared
home is that, in the user's understanding, sessions revive transparently
after an account switch. Their rollouts stay in the same home, and the only
cost is a cold prompt cache on the new account. Separate homes would scatter
transcripts across account directories and lose that continuity. Verify this
revival before choosing between the two.

Found 2026-09-30 while fixing Codex turns that failed with a 403 after a
switch to a subscription not enrolled in the Cyber Access Program.
