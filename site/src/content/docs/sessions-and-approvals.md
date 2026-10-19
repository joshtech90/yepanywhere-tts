---
title: Sessions and approvals
description: Start and resume sessions, supervise tool requests, steer compatible agents, and queue safe follow-ups.
---

The session view combines the user/agent conversation with tool activity,
approvals, diffs, files, usage, and delivery controls. Agents run on the server,
so browser disconnects do not by themselves stop active work.

## Start and resume

Use **New session** to choose a project, provider, model, permission mode, and
thinking controls. Every existing Claude Code and Codex session appears in the
session inbox and can be opened or resumed with its history.

The inbox groups sessions by attention and activity so a waiting approval does
not disappear among recent but idle work. Star or archive sessions to keep the
working set useful.

## Continue in another desktop app

### Claude Desktop

Use an explicit resume link to import a local YA-created Claude Code session
into Claude Desktop. Its **Import CLI sessions** button and `/resume` picker
can omit sessions created through the Claude Agent SDK, including YA sessions.

1. Wait for the current response to finish. In the session menu, choose
   **Copy session id** to copy the full Claude session UUID.
2. If YA still owns the provider process, choose **Terminate** in that menu.
   Closing the browser tab or interrupting a turn does not release the process.
3. On the Mac where the session files live and Claude Desktop is installed,
   open this link, replacing the placeholder with that UUID:

   ```sh
   open 'claude://resume?session=YOUR_CLAUDE_SESSION_UUID'
   ```

Desktop imports the existing conversation even when it was absent from its
picker. Keep the normal SDK launch settings; no `CLAUDE_CODE_ENTRYPOINT`
override or transcript editing is needed. Continue from only one app at a time:
do not send another YA turn while Desktop owns the session.

This route was verified on macOS with Claude Desktop 2.37337.1 and Claude Code
2.1.296. Recent Claude Code CLIs also expose
`claude --desktop --resume <session-id>`; see Anthropic's
[Desktop handoff documentation](https://code.claude.com/docs/en/desktop#coming-from-the-cli).

### ChatGPT desktop

ChatGPT desktop can automatically import YA-created Claude Code sessions from
local Claude history. With automatic updates configured, no per-session import
action in YA is needed. If the sessions already appear, you can open them there
directly.

If they do not appear, check **Settings → Import** and its automatic updates
setting. OpenAI documents importing supported recent Claude Code history,
currently chats from the last 30 days; see
[Import from another agent](https://learn.chatgpt.com/docs/import). This imports
history into ChatGPT chats; it is separate from Claude Desktop continuing the
original Claude session.

## Choose the transcript detail

The full activity transcript preserves the conversation, every tool call, and
thinking when the provider makes it available. Expand individual tool and
thinking blocks when you need their detail.

Use **Conversation view** to condense routine activity into a calmer reading
flow. Collapsing a block or switching views changes only the presentation; the
underlying session detail remains available in the full activity transcript.

## Approvals and permission modes

When a provider asks to use a guarded tool, the session shows the proposed
action and available choices. Review paths, commands, and unsafe Unicode before
approving. Rejection returns control to the agent without pretending the tool
ran.

Permission modes are provider-dependent. More permissive modes reduce prompts
and increase risk; use them only in a project and environment where the agent
is allowed to make those changes.

## Steer, queue, and interrupt

- **Steer** sends guidance into a compatible active turn.
- **Queue** preserves a follow-up for delivery after the current turn reaches a
  safe boundary.
- **Interrupt** asks the provider to stop the active turn.

The UI reflects provider differences. A missing steering control does not mean
the app will silently emulate mid-turn delivery. Queued text is delivered
verbatim by default.

Use [Project Queue](/docs/project-queue) when work should wait for the entire
project—not merely the current session—to become quiet.

## Search, recaps, and activity

Session search helps locate older work. Recaps summarize bounded activity when
you return to long-running sessions. The global activity view shows
what active agents are doing across sessions without requiring every transcript
to remain open.

## Fork and clone

Conversation forking and cloning are experimental and provider-dependent. A
clone copies through the latest completed response; a boundary fork copies a
completed prefix. The source session remains available. Actions are disabled
when a safe completed boundary does not exist rather than copying a partial
provider turn.

## Attachments

Attach screenshots, photos, PDFs, or code files from the composer. Uploads are
staged with the draft and materialized for the target session when sent. Review
the destination session before sending sensitive material.
