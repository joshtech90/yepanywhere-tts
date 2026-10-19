# Provider wait and background work evidence

This companion preserves the dated provider observations behind
[`provider-wait-and-background-work.md`](provider-wait-and-background-work.md):
how Claude and Codex wait, run work in the background, and wake themselves,
and what YA captured at the time. It is evidence, not the current product
contract. Provider behavior here is version-specific; recheck it after a
provider refresh before relying on it.

## 2026-10-15 — Live probes, Claude and Codex

### Setup

Each provider received the same natural-language prompts in a scratch Git
directory, so the model chose its own mechanism:

| Label | Prompt |
|---|---|
| checkin | "Check in with me in 5 minutes." (Codex also 10 minutes) |
| remind | "Remind me in 4 minutes to stretch." |
| build | "Kick off the build: `sleep 150 && echo BUILD OK`. It takes a couple minutes. Let me know when it finishes." |
| devserver | "Start a local static file server for this directory on port N (python3 -m http.server is fine) so I can browse it, and let me know when it's up." |
| monitor | "Start python3 -m http.server N here and keep an eye on it. Check back in 3 minutes and tell me whether it's still serving." |
| subagent | "Spawn a subagent that waits 2 minutes and then reports the current time back to you. Tell me what it reports." |

**Codex.** `codex-cli 0.160.0` (`~/.local/bin/codex`), model `gpt-6.1-sol`,
reasoning effort `low` (persistent mode off). A raw probe spawned
`codex app-server`, sent `initialize` with `experimentalApi: true`,
`thread/start` (ephemeral) and one `turn/start`, logged every notification,
and every 30 s called `thread/backgroundTerminals/list` and `thread/read`.
The devserver and monitor runs used `sandbox: "danger-full-access"`; under
`workspace-write` the sandbox refused the port bind. Three more sessions were
started through YA (`POST /api/sessions`, `provider: "codex"`,
`bypassPermissions`) and polled through `GET /api/sessions/:id/process`.

**Claude.** Agent SDK 0.3.296 as resolved by `packages/server`, CLI 2.1.296,
default model `claude-sonnet-5-5`, `settingSources: ["user", "project",
"local"]`, streaming input held open for the whole run (as YA does, so the
process survives `result`), and a Stop hook that logged its input. Every
`system` message was logged. YA-owned Claude was observed only through the
existing session (`sdk-live-tasks:1`), not through YA-launched probes.

Source cross-check: Codex Rust source at `references/codex` tag
`rust-v0.162.1` (YA's `expectedVersion`), compared with
`~/github/codex` main `5fff6378d6` (2026-10-15). Neither checkout has a
`rust-v0.160.0` tag. No difference was found for the items below between
0.162.1 and main. Paths are relative to `codex-rs/`.

### Codex observations

Codex has three distinct waiting shapes. None of them is visible in
`ThreadStatus` beyond `active` versus `idle`.

**Sleeping inside a turn.** checkin (5 and 10 minutes), remind and monitor
kept one turn `active` and chained `clock.sleep` calls between model steps:
`item/started` `{"type":"sleep","durationMs":60000}`, then `item/completed`
60 s later, then another model step. Observed durations: 60000, 55000,
40000 and 35000 ms, so a 10-minute check-in was about ten sleeps and ten
model steps. The rollout stores each as a `function_call` named `sleep` in
namespace `clock`; YA's transcript shows it as `tool_use sleep
{"duration_ms": 60000}` with result `Wall time: 60.0 seconds\nSleep
completed.`

- Bound is 1 to 43,200,000 ms (12 h): `core/src/tools/handlers/sleep.rs:26-42`.
- The tool is model-dependent. Feature `sleep_tool` is stable and on, but in
  the default `model_driven` mode the tool registers only when the model
  catalog's `experimental_supported_tools` contains `"clock"` (bundled
  gpt-6 models do; gpt-5.x models do not), unless
  `[features.sleep_tool] mode = "always_on"`: `core/src/tools/spec_plan.rs:1300-1326`.
- A sleep ends early on steer input or inter-agent mail
  (`"Sleep interrupted by new input."`): `sleep.rs:108-157`.
- Persistent mode is reasoning effort `"persistent"`, not a flag. Its
  instructions tell the model to stay in the turn and use `clock.sleep`; it
  also force-enables the sleep tool: `core/src/session/time_reminder.rs:17-36`,
  `features/src/lib.rs:566-568`. It was not active in these probes.

**Waiting on a foreground command.** build started
`sleep 150 && echo BUILD OK` through unified exec (`source:
"unifiedExecStartup"`), kept the turn `active`, polled it twice
(`item/commandExecution/terminalInteraction`, commentary "still running"),
then reported on `item/completed` (`exitCode 0`, `durationMs 149892`) and
ended the turn. `thread/backgroundTerminals/list` listed the command while it
ran.

**Background terminal after the turn.** devserver started
`python3 -m http.server`, verified it with curl, and completed the turn. From
then on `thread/status/changed` and `thread/read` reported `{"type":"idle"}`
with no flags, the command item stayed `inProgress` with no `item/completed`,
and only `thread/backgroundTerminals/list` showed the process
(`itemId`, `processId`, `command`, `cwd`; `osPid`, `cpuPercent` and `rssKb`
null). monitor ended the same way after its three-minute check.

- The list RPCs are `#[experimental]` and need `capabilities.experimentalApi`;
  the null fields are hardcoded: `app-server-protocol/src/protocol/common.rs:749-766`,
  `app-server/src/request_processors/thread_processor.rs:2387-2448`.
- No notification reports changes to the set. Output keeps streaming as
  `item/commandExecution/outputDelta` on the original item.
- Soft cap of 64 unified-exec processes with LRU pruning, no TTL:
  `core/src/unified_exec/mod.rs:82`, `process_manager.rs:1722-1793`.

**Late completion does not wake the model.** A background `sleep 300` that
exited after its turn produced a late `item/completed` (`status
"completed"`, `exitCode 0`, `durationMs 299869`, original `turnId`), the
list emptied, and no turn started. The exit watcher emits against the original
turn and never touches the input queue; no exit-wake option exists:
`core/src/unified_exec/async_watcher.rs:158-243,331-375`.

**Process teardown kills background terminals.** SIGTERM to a raw
`codex app-server` killed a background `sleep 222`. Stdio SIGTERM and stdin
EOF both run thread shutdown, which `killpg`s each unified-exec process group:
`app-server/src/lib.rs:1182-1341`, `core/src/session/handlers.rs:290-313`,
`utils/pty/src/pty.rs:93-110`. A loaded thread with no subscribers unloads
after `thread_unload_delay_secs` (default 60) of non-`Active` time and is
shut down the same way; background terminals do not count as activity:
`app-server/src/request_processors/thread_lifecycle.rs:20-87,374-487`.
SIGKILL of the app-server runs no cleanup on macOS.

**Subagents.** The child runs on its own thread: the parent gets
`subAgentActivity` (`kind: "started"`, `agentThreadId`, `agentPath`) and
the child's own `turn/started`, while the parent waits in its turn with
`clock.sleep` or `wait_agent` (`collabAgentToolCall`). A child can outlive
the parent turn; its completion mail uses `trigger_turn: false`, so an idle
parent does not wake: `core/src/agent/control/completion.rs:50-117`. The
first spawn in the probe failed only because the probe thread was ephemeral
(no rollout).

**Turns Codex can start by itself.** Goals (`turn_trigger: "goal"`, stable
and on by default), the experimental thread queue (`"queue"`) and
inter-agent mail with `trigger_turn` all emit an ordinary `turn/started`
with no trigger field: `app-server/src/bespoke_event_handling.rs:155-184`,
`ext/goal/src/runtime.rs:425-505`, `ext/queue/src/service.rs:438-565`.
Codex has no per-thread timer or cron; `ScheduledTaskSummary` is plugin
metadata only.

**ThreadStatus.** `NotLoaded | Idle | SystemError | Active{activeFlags}`;
the only flags are `waitingOnApproval` and `waitingOnUserInput`:
`app-server-protocol/src/protocol/v2/thread.rs:1665-1682`.

### Claude observations

Claude prefers ending the turn and letting background work or a scheduler
wake it.

| Prompt | Mechanism | Signals |
|---|---|---|
| checkin (5 min) | `Bash` `sleep 300` with `run_in_background: true`, turn ends | `background_tasks_changed` `[local_bash]`, `task_started` (`is_backgrounded: true`), Stop hook `background_tasks: [{type: "shell", status: "running", command}]` |
| build | Same, with the build command | Same |
| remind | `CronCreate` one-shot (`52 14 15 10 *`, "Session-only … dies when Claude exits") | Stop hook `session_crons` only; no system message |
| monitor | Background `python3 -m http.server`, then `ScheduleWakeup(180)` | Background task plus Stop hook `session_crons` entry (`52 14 * * *`, `recurring: false`) |
| devserver | `nohup python3 -m http.server … &` inside a background Bash call | Task completes as soon as the launcher shell exits; the server keeps running untracked, reparented to PID 1 |
| subagent | Foreground `Agent` call (`is_backgrounded: false`) | `task_started` `local_agent` (`subagent_type`, `spawn_depth`), `task_progress`, `tool_progress` heartbeat every 30 s; the child's Bash is a `local_bash` task with `owned_by_subagent: true` and `parent_task_id` |

**Wakes.** When a background task finished after the turn, the CLI emitted
`task_updated` (`status: "completed"`), `task_notification`, an empty
`background_tasks_changed`, a fresh `system/init`, then a new turn and
`result`. A due cron emitted `command_lifecycle` `started`, `system/init`, a
turn, `result`, then `command_lifecycle` `completed`. No
`session_state_changed` was logged in this harness.

**Session crons wait for background tasks to finish.** A
`ScheduleWakeup` due at 14:59:00 fired at 14:59:02 in a session with no
background task. The same request in a session running a background
`python3 -m http.server` was still pending two minutes after it was due. In
that run and in the monitor probe, the overdue wakeup fired within one second
of the probe ending, which both closed the streaming input and aborted the
query (killing the server); which of the two released it was not isolated.
`ScheduleWakeup` is minute-granular: a 60 s request was scheduled as
"14:59:00 (in 111s)".

**Teardown.** Aborting the SDK query killed a backgrounded
`python3 -m http.server`; the `nohup`-detached server survived its session.

**What the SDK distinguishes.** `background_tasks_changed` entries carry
`task_type` (`local_bash`, `local_agent`, `local_workflow`, `mcp_task`,
monitor tasks), `description`, `subagent_type`, `parent_task_id` and
`ambient`. Crons and wakeups appear only in Stop-hook `session_crons`, so a
host learns about them at turn end.

### What YA captured

- **Claude.** `ClaudeProviderRetentionTracker` keeps counts only:
  `sdk-live-tasks:N`, `stop-hook-background-tasks:N`,
  `stop-hook-session-crons:N`. It drops `task_type`, `description`, the
  command and cron schedules. The existing session `56bdeeb2` (one live task)
  reported raw state `idle`, `derivedStatus: "verified-waiting-provider"`, and
  `activity: "in-turn"` on rows, indistinguishable from a model turn.
- **Codex.** No retention source exists. The YA session that started
  `sleep 900` reported `idle` / `verified-idle` with empty retention for the
  whole 15 minutes. The YA dev-server session reported the same while its
  server answered HTTP 200. The late `item/completed` updated
  `lastRawProviderEventAt` (`codex:notification:item/completed`) but added
  nothing to the transcript and changed no state.
- **Codex in-turn sleeps.** The YA check-in session reported `in-turn` /
  `verified-progressing` for five minutes; `silenceMs` reached about 60 s
  between sleeps. A single longer sleep, which the tool allows, would pass
  the five-minute `long-silent-unverified` threshold.
- YA's Codex provider tracks `backgroundToolCallIds` per turn only and clears
  them at the next turn start (`packages/server/src/sdk/providers/codex.ts`
  `updateBackgroundProcessTracking`). YA does not call
  `thread/backgroundTerminals/list` and does not normalize live `sleep` items.

## 2026-10-15 — YA capture validation

Setup: standalone dev profiles from this checkout, Codex CLI 0.160.0 and
Claude Agent SDK 0.3.296 (CLI 2.1.296), sessions started through
`POST /api/sessions` and polled every 2 s through
`GET /api/sessions/:id/process`. Profile `bgwork` (port 4600) ran
providers in-process; profile `bgwork-host` (port 4700) used the provider
host (`YEP_PROVIDER_HOST_ENABLED=true`), so snapshots crossed the host
boundary. The second round used `IDLE_TIMEOUT=150`. YA's default Claude model
in these profiles chose different mechanisms from the earlier SDK probe
(Sonnet): a foreground Bash `sleep 180` for "check in", and background Bash
sleeps instead of `CronCreate` or `ScheduleWakeup` for two of three
reminders.

Twelve concurrent sessions first froze the 4600 server: concurrent
`flush()` calls on the SQLite-backed `SessionMetadataService` saver re-armed
each other's drains in microtasks forever. Fixed in `createCoalescingSaver`
before the runs below; afterwards twelve concurrent sessions kept the API
answering in about 1 ms.

| Scenario | Observed record |
|---|---|
| Claude background build | `shell` work with command, retained; cleared and woke at completion |
| Claude reminder (`CronCreate`) | `cron` work with schedule `48 15 15 10 *`; cleared after it fired |
| Claude background subagent | `subagent` work (`local_agent`); cleared on completion, new turn |
| Claude monitor | background server plus a background `sleep 120; curl` check; the server stayed recorded and retained after the check |
| Claude foreground check-in | `shell` wait (`claude:task_started`) for the whole three minutes |
| Claude `nohup` dev server | nothing after the launcher returned (untracked, as expected) |
| Codex check-in | successive `clock.sleep` waits with `until`; none after the turn |
| Codex build | the command as `shell` work during the turn; cleared at exit |
| Codex dev server | `shell` work through and after the turn, `verified-idle`, not retained |
| Codex `sleep 120` left running | recorded after the turn; cleared at its exit while idle |
| Codex subagent | child as `subagent` work (`/root/time_after_minute`); `wait_agent` waits; both cleared |

Reaping with a 150 s grace: a Codex dev-server session idle at 15:52:33 was
reaped at 15:55:03 and its port freed; a session whose background `sleep
60` exited at 15:53:27, after it went idle at 15:52:31, was reaped at
15:55:02, so the exit did not restart the grace; a Claude session retaining
a background server was not reaped. The provider-host profile recorded the
same items as the in-process one.
