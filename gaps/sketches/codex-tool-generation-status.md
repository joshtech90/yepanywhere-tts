# Show when Codex is generating a tool call

The processing indicator now states silence ("No new output for 3m 10s")
instead of rotating phrases, but it cannot say why a Codex turn is silent. The
common cause is a large tool call whose input the model is still generating:
the 0.164 app-server emits nothing until the input is complete
(`item/started` fires only at execution), so a multi-minute file write looks
the same as a stalled upstream stream.

Codex's own trace log can tell the difference at the start of generation.
`~/.codex/logs_2.sqlite` (table `logs`, indexed by `thread_id`) records
`Output item item_type="custom_tool_call"` when the model begins a tool call.
YA could read the newest such row for the active thread and extend the
indicator to "No new output for 3m 10s · tool call generating since 19:40:33".

Constraints:

- The log is an uncontracted debug surface; parse defensively and show
  nothing when it is absent, unreadable, or its format changes.
- It records only the start, not continuing token flow, so a stall after the
  call began still looks the same. Label it as provider-log evidence, never as
  user-visible progress (`topics/session-liveness.md`).
- A proper fix is upstream: an app-server notification streaming tool-call
  input, which would let YA render the draft as it is written.

Origin: 2026-10-23 diagnosis of Codex session
`01a16a16-00e5-7ad3-b041-e4b33c053db9`, which looked idle for 20 minutes while
regenerating a file write that each user steer cancelled. The steer loss is
fixed separately (`topics/steer-queue-provider-differences.md`).
