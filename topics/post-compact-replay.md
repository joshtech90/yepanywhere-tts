# Post-compact actions and retired replay policy

Topic: post-compact-replay

Related: [resume compaction](resume-compaction.md),
[injected-message visibility](injected-message-visibility.md),
[core house cleaning](core-house-cleaning.md).

## Selected disposition

**Removed, 2026-10-27:** the per-provider replay checkbox, history-count
configuration, rolling prose collection and generated quoted-history/`continue.`
message are retired. Saved enablement is inert and omitted from settings
responses. Stale writes cannot re-enable it. The client does not expose the
controls with either new or older servers. Explicit `/goal` remains the way to
supply sustained-task intent; cleanup does not create a replacement prompt.

## Retained post-compact action capability

The runtime can supply an explicit `postCompactAction` to Supervisor. No action
is installed by default, and the web app installs no replay action. The hook
is eligible after a compact boundary or compact-success status, when genuinely
idle, without retained provider work, queued/deferred input, termination or an
automation pause. Newer user input cancels the pending action. Consume the
pending action before dispatch so an idle notification cannot send it twice.
Unregistering a process releases its pending action. An action uses the same
ordinary input admission path with steering disabled; it does not gain a
second provider owner or elevated message role. Hook and dispatch exceptions
are logged and consumed without an automatic retry or an unhandled rejection;
ordinary user input remains available.

Native compaction, threshold policy, ordinary queued input and general hidden
injected-message support are retained independently. Compaction completion is
not itself proof of readiness for the next queued turn.

## Historical transcript recognition

The stable opener `This session is being continued after compaction (Yep
Anywhere replay).` still identifies historical hidden replay rows. Projection
continues to hide those rows without requiring the removed generator, prose
buffer or settings. Existing transcripts are not rewritten or deleted.

## Verification

Supervisor integration tests cover an explicit runtime action and no automatic
continuation by default. Shared transcript recognition remains tested. Settings
persistence verifies old enablement becomes inert without disturbing retained
settings. [Plan 164](../docs/tactical/164-remove-retired-session-automation.md)
records the complete removal pass and independent review.
