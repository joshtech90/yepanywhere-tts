# Conversation view crashes with "Maximum update depth exceeded"

A live Claude session in Conversation view crashed the client on
2026-09-13T06:21:29.783Z (client and server both `0.8.1-304-g5ab8ec6e5`,
Windows Chrome 153). React threw

    Maximum update depth exceeded. This can happen when a component repeatedly
    calls setState inside componentWillUpdate or componentDidUpdate.

from `getRootForUpdatedFiber`, with the enqueue coming from the passive effect
at `packages/client/src/components/RenderItemComponent.tsx:792` — the
`setAutoHidePhase("visible")` in `ConversationActivitySummary`'s thinking
auto-hide effect. DOM at capture: 819 nodes, 17 message rows, 4 conversation
activity rows, 1 thinking preview, no streaming block.

## Why the named line is not (necessarily) the defect

React throws this at whatever update happens to be enqueued *after* the limit
is already crossed. `nestedUpdateCount` rises once per commit that leaves
Sync/InputContinuous/Default lane work pending (react-dom
`commitRootImpl`), so 51 consecutive such commits — from anywhere in the tree —
arm the throw, and the next `setState` raises it. The auto-hide effect is a
plausible participant (it re-runs whenever `item.active`, `item.endedAtMs`,
`item.hasFollowingConversationText`, or `thinkingShownSinceMs` changes, and
writes the phase on every run), but a loop confined to that component needs
`item.thinkingPreviews?.length` or `item.active` to alternate on every commit,
which nothing in `projectConversationView` was observed to do.

## What the server log says about the trigger

With debug logging on, `~/.yep-anywhere/logs/server.log` around the crash shows
no transcript traffic for 14 s beforehand: the last `session-updated` was at
-14.094 s, and the only thing forwarded at the crash instant (+0.001 s) was a
pair of `cache-miss-billing` events (3 subscriptions × 2 events). The client
unsubscribed 1.27 s later — the error boundary tearing the app down. So the
cascade was not a transcript flood; it followed a single activity-bus event,
whose only known client effect is a toast
(`packages/client/src/components/CacheMissBillingToasts.tsx`). An identical
`cache-miss-billing` burst 19 s earlier did not crash the tab.

## Cheap next step

Not reproducible from the recorded transcript alone, and the crash report
itself cannot name the loop. `captureCrashContext` now records the tab's
visibility and the activity bus's recent-event trail, so the next occurrence
distinguishes a single event's cascade from a burst without needing
server-side debug logs. Beyond that, identifying the looping component needs
per-commit attribution (a root `Profiler` behind the browser-debug performance
flag, or React DevTools on a reproducing tab).

Found 2026-09-13 while diagnosing a user-reported client fatal error.
