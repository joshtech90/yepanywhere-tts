# Remote-executor sync writes to ~/.claude even when CLAUDE_CONFIG_DIR is set

`getSessionsPath` in `packages/server/src/sdk/session-sync.ts` defaults the
local destination to `~/.claude/projects` and the Claude provider's post-turn
`syncSessionFile` call (`packages/server/src/sdk/providers/claude.ts`, after a
remote `result`) passes no local base directory. A server whose
`CLAUDE_CONFIG_DIR` points elsewhere scans that directory but receives executor
transcripts in `~/.claude/projects`, so remote sessions never appear or update
in its UI. `getProjectDirFromCwd` also replaces only slashes and colons, while
Claude's own folder name replaces dots too (`~/code/.worktrees/x` becomes
`-Users-…-code--worktrees-x`), so a cwd containing a dot syncs into a
different folder from the one Claude writes.

Not fixed in place because it was found while validating session ids. Fix by
passing the configured Claude projects directory (the scanner's
`claudeProjectsDir`) to both sync directions and deriving the folder name with
Claude's rule.

Found 2026-10-11 while running plan 150's executor probe with a throwaway
CLAUDE_CONFIG_DIR.
