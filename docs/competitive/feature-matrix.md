# Feature Comparison Matrix

Historical comparison of AI coding agent supervisors, recorded 2026-02-03.
The tables below have not been comprehensively refreshed: several YA entries,
including desktop distribution and Source Control, are now obsolete. Do not
use them as a current gap list.

## Newer source reviews

- [CosmoRemote — 2026-09-20](cosmoremote.md#feature-comparison-with-yep-anywhere):
  native mobile distribution, multi-Mac fleet, remote simulator testing,
  security/approval boundaries, and partial-source licensing review.
- [Zed DeltaDB / Delta — 2026-09-15](deltadb.md#feature-comparison-with-yep-anywhere):
  provenance, branching, and multiplayer comparison against a closed hosted
  product, inferred from Zed's open CRDT crates and published claims.
- [bb — 2026-09-13](bb.md#feature-comparison-with-yep-anywhere): current paired
  comparison, with source/release distinctions and provider-specific limits.
- [T3 Code — 2026-09-04](t3code.md): source review covering web, desktop,
  mobile, orchestration and Git workflows.

The [roadmap](../roadmap/README.md) owns current YA status and priorities.
Adding these links does not refresh the historical cells below.

## Platforms

| Platform | yepanywhere | Codex App | Claude Desktop | emdash | Conductor | HAPI | Happy |
|----------|-------------|-----------|----------------|--------|-----------|------|-------|
| Web | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| macOS | ✅ (web) | ✅ | ✅ | ✅ | ✅ | ✅ (web) | ✅ |
| Windows | ✅ (web) | ❌ | ✅ | ✅ | ❌ | ✅ (web) | ✅ (web) |
| Linux | ✅ (web) | ❌ | ✅ | ✅ | ❌ | ✅ (web) | ✅ (web) |
| iOS | ✅ (PWA) | ❌ | ❌ | ❌ | ❌ | ✅ (PWA) | ✅ (native) |
| Android | ✅ (PWA) | ❌ | ❌ | ❌ | ❌ | ✅ (PWA) | ✅ (native) |

## Agent Support

| Agent | yepanywhere | Codex App | Claude Desktop | emdash | Conductor | HAPI | Happy |
|-------|-------------|-----------|----------------|--------|-----------|------|-------|
| Claude Code | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Codex | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Codex OSS | ✅ | ❌ | ❌ | ? | ❌ | ❌ | ❌ |
| Gemini | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ |
| OpenCode | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ |
| Cursor | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Copilot | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Aider | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |

## Session Management

| Feature | yepanywhere | Codex App | Claude Desktop | emdash | Conductor | HAPI | Happy |
|---------|-------------|-----------|----------------|--------|-----------|------|-------|
| Multi-session dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Session persistence | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Session resume | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fork conversation | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Clone conversation | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Archive/star | ✅ | ? | ? | ✅ | ✅ | ✅ | ? |
| Rename sessions | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| Bulk operations | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Tiered inbox | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Global activity stream | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

## Execution Model

| Feature | yepanywhere | Codex App | Claude Desktop | emdash | Conductor | HAPI | Happy |
|---------|-------------|-----------|----------------|--------|-----------|------|-------|
| Local execution | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cloud execution | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Server-owned processes | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Survives client disconnect | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Survives machine shutdown | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Parallel agents | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |

## Git Integration

| Feature | yepanywhere | Codex App | Claude Desktop | emdash | Conductor | HAPI | Happy |
|---------|-------------|-----------|----------------|--------|-----------|------|-------|
| Git worktree per session | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Working tree diff viewer | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Git status display | ❌ | ✅ | ? | ✅ | ✅ | ✅ | ❌ |
| Commit from UI | ❌ | ✅ | ? | ✅ | ✅ | ✅ | ❌ |
| PR creation | ❌ | ✅ | ? | ✅ | ✅ | ? | ❌ |

## Code Review

| Feature | yepanywhere | Codex App | Claude Desktop | emdash | Conductor | HAPI | Happy |
|---------|-------------|-----------|----------------|--------|-----------|------|-------|
| Inline diff view | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| File-by-file diff | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Diff commenting | ❌ | ? | ✅ | ? | ? | ? | ❌ |
| Merge workflow | ❌ | ✅ | ? | ✅ | ✅ | ? | ❌ |

## Permissions & Approval

| Feature | yepanywhere | Codex App | Claude Desktop | emdash | Conductor | HAPI | Happy |
|---------|-------------|-----------|----------------|--------|-----------|------|-------|
| Permission approval UI | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Permission modes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| YOLO/auto-approve mode | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| Push notifications | ✅ | ? | ❌ | ❌ | ❌ | ? | ✅ |

## UI Features

| Feature | yepanywhere | Codex App | Claude Desktop | emdash | Conductor | HAPI | Happy |
|---------|-------------|-----------|----------------|--------|-----------|------|-------|
| Real-time streaming | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Thinking/reasoning display | ✅ | ✅ | ✅ | ✅ | ? | ✅ | ? |
| Todo list display | ✅ | ✅ | ✅ | ? | ? | ✅ | ? |
| Context usage tracking | ✅ | ? | ❌ | ❌ | ❌ | ❌ | ❌ |
| Draft persistence | ✅ | ? | ? | ❌ | ❌ | ❌ | ❌ |
| Subagent inspection | ✅ | ? | ? | ? | ? | ✅ | ? |
| Terminal page | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| File browser | ❌ | ? | ? | ✅ | ? | ✅ | ❌ |
| Kanban view | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |

## Security & Networking

| Feature | yepanywhere | Codex App | Claude Desktop | emdash | Conductor | HAPI | Happy |
|---------|-------------|-----------|----------------|--------|-----------|------|-------|
| E2E encryption | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Relay for remote access | ✅ | N/A (cloud) | N/A (cloud) | ❌ | ❌ | ❌ | ✅ |
| Tailscale support | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Zero external deps | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ |

## Advanced Features

| Feature | yepanywhere | Codex App | Claude Desktop | emdash | Conductor | HAPI | Happy |
|---------|-------------|-----------|----------------|--------|-----------|------|-------|
| MCP integration | ✅ | ? | ✅ | ✅ | ? | ? | ❌ |
| Voice commands | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Automations/triggers | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Compare agent outputs | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Skills system | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

## Installation & Distribution

| Aspect | yepanywhere | Codex App | Claude Desktop | emdash | Conductor | HAPI | Happy |
|--------|-------------|-----------|----------------|--------|-----------|------|-------|
| Signed installer/DMG | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| No Node.js required | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| npm install | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Single binary | ❌ | ✅ | ✅ | ? | ✅ | ✅ (Bun) | ❌ |
| Homebrew | ❌ | ? | ? | ? | ? | ? | ❌ |
| Docker | ❌ | ❌ | ❌ | ❌ | ❌ | ? | ❌ |

## Licensing & Pricing

| Aspect | yepanywhere | Codex App | Claude Desktop | emdash | Conductor | HAPI | Happy |
|--------|-------------|-----------|----------------|--------|-----------|------|-------|
| Open source | ✅ MIT | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ MIT |
| Free tier | ✅ | ✅ (limits) | ❌ | ✅ | ? | ✅ | ✅ |
| Self-hosted | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ |

## Summary: yepanywhere Strengths

Features we uniquely have or lead in:
- Fork/clone conversations
- Tiered inbox
- Global activity stream
- Bulk operations
- Context usage tracking
- Draft persistence
- E2E encryption + relay (shared with Happy)
- Multi-provider (Claude, Codex, Codex OSS, Gemini)

## Summary: Gaps to Address

Features competitors have that we lack:
- **Signed installer** — No Node.js required (Codex App, Claude Desktop, emdash, Conductor)
- Git worktree per session (emdash, Conductor, HAPI, Codex App)
- Working tree diff viewer (most competitors)
- Diff commenting (Claude Desktop)
- Automations/scheduling (Codex App)

## Last Updated

2026-02-03
