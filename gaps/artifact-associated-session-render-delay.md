# Artifact-associated session loading still needs live-tab verification

The September 22 report included minute-long session loading, delayed window
resize/repaint, and a send whose HTTP response failed after the provider had
already answered. Closing two standalone copies of the same HTML artifact
immediately restored the affected session and its embedded App pane. After a
frontend reload, the user still observed over 20 seconds at “Rendering
transcript 75%”. The last delay is not established as resolved.

Two YA cross-tab storage feedback defects were reproduced and fixed: App
discovery wrote its local latest app back after another tab's update, and
scroll-position reconciliation created a fresh observation even without an
advance. The isolated two-tab browser check stalled after only the App fix;
with both fixes it completed in 3.9 seconds, with four storage events and
successful sequential typing and resize. This does not reproduce the complete
reported artifact-tab interaction.

Fresh browser probes loaded the affected session promptly, including with two
copies of the exact paper artifact open and its App pane selected. No browser
errors were observed. The HTML is about 14 MB and is served on a separate
artifact origin. Origin separation prevents direct sharing of YA localStorage;
it does not establish renderer/process independence. Chrome storage throttling
and the remaining progressive-render delay are unverified hypotheses.

Next evidence should come from the affected browser: verify all YA tabs have
the fixes, capture storage event counts and a main-thread profile while the
rendering indicator is stalled, and compare the same tab with the standalone
artifact views open and closed. Preserve the distinction between time fetching
history and time rendering it. Relevant owners are `MessageList` progressive
hydration, `sessionScrollMemoryStorage`, and `useSessionRightPane`.

Further observations: live responses become visible only after reload, and the
Bug toolbar control itself can stop responding. Reloading briefly restores
progress before another freeze. The current source excludes artifacts and
right-pane viewers from `sessionViewerFreezesTranscript`; that controller is
tab-local and checks the owning session ID. Retained-route pause signals are
also session-specific. No "artifact open anywhere" freeze was found. The live
localhost Vite endpoint serves the fixed App persistence effect, but that does
not establish that every already-open tab has applied it. Two older YA tabs
could continue the storage loop despite reloading the affected tab.

Minimizing a pane deliberately retains its iframe and cannot be assumed to
stop its JavaScript. A fresh-browser probe of the exact session, including
opening and minimizing its App, did not reproduce the minute-long stall.
These were diagnostic observations during concurrent browser-suite execution,
not calibrated performance measurements. No affected-tab debug grant was
available because the user's Bug control was itself unresponsive.

An apparent cross-session App opening during investigation had a different
explanation: a diagnostic tool result printed the artifact URL, which current
discovery treats as a new App announcement in the investigation session.
Avoid emitting the artifact URL in diagnostic output; that changes the UI
being investigated. This observation does not prove cross-tab viewer events.

Found 2026-09-22 while fixing session stalls and delivered-draft recovery.
Contributing-model: 6-Astra
