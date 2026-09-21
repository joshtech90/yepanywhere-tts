# CosmoRemote

**Website:** https://cosmoremote.com/
**App stores:** [Apple App Store](https://apps.apple.com/app/cosmoremote/id6761442464), [Google Play](https://play.google.com/store/apps/details?id=com.cosmohq.cosmoremote)
**Bridge package:** https://www.npmjs.com/package/cosmoremote
**Public GitHub repository:** https://github.com/maththedev42/cosmoremote
**Type:** Native mobile client + Mac bridge + hosted relay
**Agents:** Claude Code, Codex, Cursor Agent, terminal
**Pricing:** Free tier; Pro listed at $2.99/month or $29.99/year
**Version reviewed:** Bridge 2.4.0; iOS app 2.1
**Review date:** 2026-09-20

## Overview

CosmoRemote is a close mobile-first competitor to Yep Anywhere. A Node bridge
runs on a Mac and exposes Claude Code, Codex, Cursor Agent, and ordinary shell
sessions to native phone and tablet apps. It combines a multi-Mac fleet view,
provider-native conversation continuation, remote prompts and terminal access,
push notifications, offline-readable history, and a notable Tests workflow that
builds an app on the Mac and streams an interactive simulator or emulator to the
phone.

The official website still says Android is coming soon, but the
[Google Play listing](https://play.google.com/store/apps/details?id=com.cosmohq.cosmoremote)
is live. Store availability takes precedence for this snapshot. Pricing and free
concurrency limits also differ between the current website and store copy, so
those limits should be rechecked rather than treated as a durable contract.

## Is it open source?

**No, not as a complete product. Only the distributed bridge is MIT-labeled.**

- The published
  [`cosmoremote` 2.4.0 package metadata](https://unpkg.com/cosmoremote@2.4.0/package.json)
  declares `MIT` and points at a `bridge` directory in the GitHub repository.
  Its npm tarball contains readable compiled JavaScript, declarations, and source
  maps, but no TypeScript sources or license file.
- The repository URL now resolves to
  [`maththedev42/cosmoremote`](https://github.com/maththedev42/cosmoremote).
  At the reviewed commit it contains the marketing website only: there is no
  `bridge` directory, mobile app, relay/backend, or license file. Its package
  manifest marks the website package private.
- No public source or open-source license was found for the iOS/Android apps or
  hosted backend. The product site says “All rights reserved.”

The safe catalog classification is therefore **partial: MIT-labeled bridge
package; mobile apps and hosted service proprietary/not publicly sourced**. The
npm license field is evidence about that distributed package, not evidence that
the whole CosmoRemote system is open source or self-hostable.

## Product Surface

| Area | Current behavior |
| --- | --- |
| Mobile | Native iPhone/iPad and Android apps; the Apple build also advertises Apple Silicon Mac and Vision compatibility |
| Host | macOS 12+ bridge installed through npm or Homebrew; no Windows or Linux host advertised |
| Fleet | Multiple Macs and parallel sessions on Pro, with CLI/host/status filters such as running, idle, needs attention, and error |
| Sessions | Start Claude, Codex, Cursor, or shell sessions; continue provider conversations discovered on disk; stream output token by token |
| History | Project-grouped and offline-readable mobile history, with optional account/cloud history according to the privacy policy |
| Remote testing | Build and launch iOS/Android apps on the Mac, stream H.264 simulator/emulator video, and forward touch, swipe, text, and key input |
| Notifications | Push when a turn finishes or a session needs attention; a Pro feature in current marketing |
| Pairing | QR token, short code, or email link depending on plan/path; same-LAN direct connection plus hosted remote relay |

## Published Bridge Architecture

This section is based on the readable JavaScript in the published
[`cosmoremote@2.4.0`](https://www.npmjs.com/package/cosmoremote) tarball, not on
unpublished mobile or backend code.

The bridge is a Node 18+ process using `ws`. Its
[server implementation](https://unpkg.com/cosmoremote@2.4.0/dist/server/server.js)
binds a WebSocket listener on `0.0.0.0:4422`, then authenticates connections at
the application layer with a QR pair token, short pairing code, or persisted
session token. Local traffic uses plain `ws://`; remote traffic uses an outbound
`wss://` connection to the hosted relay. Pair and session tokens are stored
under `~/.cosmoremote/` with owner-only permissions. Prompt tickets are verified
before a direct client prompt is run, and requested working directories are
constrained to the configured root or a directory already evidenced by provider
history.

Provider integration is more structured than a raw terminal relay:

- Claude runs as a persistent `stream-json` process and resumes the native
  Claude session id.
- Cursor runs one process per turn and resumes its native chat id.
- Codex normally uses one-shot `codex exec`; a persistent `codex app-server`
  path is present but opt-in through `COSMOREMOTE_CODEX_PROTOCOL=app-server`.
- Terminal sessions run the user's shell and keep shell state during the live
  session.
- A
  [bounded scanner](https://unpkg.com/cosmoremote@2.4.0/dist/cli-conversations.js)
  reads Claude, Codex, and Cursor transcript locations every 60 seconds to
  populate “continue conversation” and project choices without loading
  arbitrarily large history files.

Runtime continuity is transport-dependent. A direct-LAN socket closing kills
the CLI sessions owned by that connection. The published
[relay client](https://unpkg.com/cosmoremote@2.4.0/dist/server/relay-client.js)
also kills its relay-owned CLI sessions when the bridge-to-relay connection
closes, although remote test runs get a 60-second reconnect grace period.
Provider-native ids and transcripts allow later resume, but this is not the same
guarantee as keeping an active run alive across client, relay, or server
replacement.

## Security and Approval Model

CosmoRemote's marketing says “secure relay,” but its published evidence supports
transport encryption, not zero-knowledge or application-layer E2E encryption.
The [privacy policy](https://cosmoremote.com/privacy/) says prompts and outputs
may pass through the hosted relay, all relay connections use TLS, and optional
cloud history stores session metadata and output snapshots. The bridge sends
ordinary JSON prompt/output frames over its relay WebSocket. This leaves the
hosted endpoint inside the content trust boundary, unlike Yep Anywhere's
application-layer encrypted relay.

The local path is plain WebSocket on all network interfaces with bearer tokens
in the connection URL. Token persistence, short-lived signed prompt tickets,
directory containment, and owner-only secret files are useful defenses, but LAN
transport confidentiality depends on the local network.

The most consequential limitation is approvals. The published
[permission mapping](https://unpkg.com/cosmoremote@2.4.0/dist/session/options.js)
explicitly says headless CLI sessions have no interactive approval channel and
that phone-side approval is future work. Legacy/default modes normalize to full
access:

- Claude receives `--dangerously-skip-permissions`.
- Resumed Codex can receive `--dangerously-bypass-approvals-and-sandbox`; new
  full-access Codex sessions use `danger-full-access`.
- Cursor full access disables its sandbox and forces trust.

Read-only, plan, and accept-edits mappings exist, but CosmoRemote should not be
credited with a remote per-tool approval UI on the evidence reviewed.

## Feature Comparison With Yep Anywhere

| Dimension | CosmoRemote | Yep Anywhere |
| --- | --- | --- |
| Mobile distribution | Native iOS/iPadOS and Android store apps are live | PWA and Android implementation exist; public mobile-store delivery remains roadmap work |
| Host platforms | Mac bridge only | Node/web on macOS, Windows, and Linux; signed macOS and Windows desktop builds |
| Providers | Claude Code, Codex, Cursor Agent, raw terminal | Claude, Codex, Gemini, plus alternate/local variants; no Cursor or general terminal session |
| Session discovery | Reads native Claude/Codex/Cursor histories | Reads provider-native histories across supported providers with richer global indexing and triage |
| Live-run continuity | Direct or relay transport loss can terminate owned CLI sessions; provider ids support later resume | Server-owned sessions survive browser disconnect, with reload-safe provider runtimes on supported paths |
| Approvals | Modes only; no phone-side tool approval channel, with default paths mapped to full access | Structured permission requests and approval UI |
| Remote security | TLS relay; hosted service is in the content trust boundary; plain local WebSocket | SRP admission plus application-layer E2E relay encryption; self-hosted direct paths |
| Multi-machine UI | Native fleet view across Macs, with status/host/CLI filters | Multi-source work is an active product direction; current tiered inbox and activity views are deeper per server |
| Mobile testing | Integrated build, simulator/emulator video streaming, and touch control | Android-oriented device-control tooling exists, but not the same integrated native mobile build/test loop |
| Conversation operations | Continue discovered provider sessions; bulk list cleanup | Fork/clone from a selected turn, archive/star/rename, bulk operations, activity stream, and tiered inbox |
| Source and hosting | MIT-labeled bridge artifact; closed mobile/backend; hosted account/relay for remote features | MIT repository; core server/web works without a hosted account; relay can be self-hosted |

## Competitive Assessment

**Competitive threat: medium-high for Mac users who prioritize native mobile
access.** CosmoRemote is unusually direct about the use case: scan once, see all
Macs and agents in a native fleet, continue a desktop conversation, and test a
mobile build from the same phone. Its low subscription price and live store
presence reduce adoption friction. Cursor and full-terminal support also extend
its reach beyond YA's current providers.

Its strongest differentiated idea is not generic chat; it is the Tests loop.
Building on the Mac, streaming a simulator or emulator, and sending touch input
from the reviewing phone collapses agent supervision and app acceptance into one
mobile workflow.

The tradeoffs are equally material: Mac-only execution, reliance on a proprietary
hosted control plane, no demonstrated application-layer E2E encryption, plain
LAN WebSockets, no interactive remote approvals, dangerous defaults for common
permission modes, and weaker active-run continuity. Its public-source story is
also easy to overstate because the npm bridge says MIT while the linked repository
no longer contains that bridge source.

For Yep Anywhere, CosmoRemote reinforces the existing priority on shipping
native mobile distribution and coherent multi-machine grouping. It also provides
a concrete design reference for a phone-driven build/test surface. It does not
weaken YA's strongest positioning around provider-native indexing, attention
triage, fork/clone, cross-platform hosts, approval fidelity, self-hostability,
and an application-layer encrypted relay.

## Evidence and Caveats

- [Product site](https://cosmoremote.com/) — features, pricing, platform claims,
  and the stale Android “coming soon” status.
- [Apple App Store](https://apps.apple.com/app/cosmoremote/id6761442464) and
  [Google Play](https://play.google.com/store/apps/details?id=com.cosmohq.cosmoremote)
  — live distribution, store copy, version history, compatibility, and developer
  identity.
- [Privacy policy](https://cosmoremote.com/privacy/) — backend processing,
  optional cloud history, analytics, TLS relay, and third-party services.
- [`cosmoremote@2.4.0` package](https://www.npmjs.com/package/cosmoremote) —
  bridge implementation, package license metadata, provider adapters, auth,
  lifecycle, testing, and relay behavior.
- [Current public repository](https://github.com/maththedev42/cosmoremote) —
  marketing-site source only at review time, with no license or bridge/mobile/
  backend source.

Store privacy declarations say no data is collected, while the product privacy
policy describes account data, analytics, diagnostics, purchases, optional cloud
history, and relay processing. This review uses the more specific policy for the
trust-boundary analysis and records the inconsistency rather than trying to
resolve it.
