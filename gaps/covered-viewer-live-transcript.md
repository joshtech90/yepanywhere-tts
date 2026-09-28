# Covering modal viewers still pause transcript rendering

Covering non-App managed viewers in
`packages/client/src/lib/sessionViewerController.ts` still hold the covered
transcript's last committed React projection and pause progressive hydration.
This protects viewer responsiveness under the previously observed roughly
559 MB active rollout, but it intentionally delays transcript rendering until
the modal is parked or closed.

Replace that freeze with measured bounded or deferred hidden-transcript
reconciliation. Acceptance requires a real large active session with concurrent
updates: modal interaction and sequential composer input remain responsive,
every keystroke appears within 100 ms, the transcript advances while covered,
and parking reveals current content without a catch-up stall. Preserve modal
pointer/focus isolation independently of transcript scheduling.

Found 2026-09-21 while fixing artifact App iframes and right-pane artifact
reuse after a full YA restart exposed the broader freeze contract.
