# All Sessions search fails in CI despite passing locally

The `e2e-tests` job stops at its five-failure limit in
`packages/client/e2e/all-sessions-search.spec.ts`. This prevents later browser
specs from running, including the live catch-up ordering regression.
The contract is [All-Session Content Search](../topics/all-session-content-search.md).

Evidence from 2026-09-15:

- [Mirror baseline CI](https://github.com/graehl/yepanywhere/actions/runs/34934010326)
  at `d729f4bf3` already failed appended-turn discovery, arriving-match layout,
  streaming/selection, and phone fan-out assertions, including retries.
- [Mirror ordering-fix CI](https://github.com/graehl/yepanywhere/actions/runs/34937359212)
  at `c70767325` repeats the appended-turn, layout and streaming failures.
  It also fails the copy-selection assertion at line 165: right-clicking
  changes trailing newlines in `window.getSelection().toString()`.
  That assertion passed in the baseline run, so its cause remains unresolved.
- [Upstream CI](https://github.com/kzahel/yepanywhere/actions/runs/34937347553)
  also reports an `e2e-tests` failure at `c70767325`.
- The complete local browser suite passed 265 tests with 7 skipped at that
  source, including these All Sessions tests. The later focused desktop/phone
  catch-up and sequential-typing checks also passed.

The repeated baseline failures predate the ordering fix; local success does
not establish harmless flakes. Reproduce with CI's browser/runtime versions,
fresh profile, reporters and failure limit. Inspect the saved traces and
network responses for search completion/visibility failures, and compare the
selection text before and after native right-click handling. Fix the owning
contract or test oracle rather than increasing waits or suppressing failures.

Repeated at `28a58cf9b` on 2026-09-16 in both
[origin](https://github.com/kzahel/yepanywhere/actions/runs/35085173084/job/104758191326)
and [graehl](https://github.com/graehl/yepanywhere/actions/runs/35085176248/job/104758200450):
the same five appended-turn, arriving-match, desktop streaming/selection and
phone fan-out failures stopped each run after 13 passes, leaving 270 tests
unrun. This is an existing unresolved failure, not evidence of green E2E.

Captured after publication; investigating the search failures is separate
from the completed transcript-ordering fix. This note does not claim CI
validated browser tests that were never reached.

2026-09-17 — two causes found and fixed, both in the "fans out, retains both
roles, and refines cached turns" checks, which now pass on both viewports in
two consecutive clean runs (13/13 for the file):

- A product defect. Expansion out of the initial streaming shape was armed by
  an effect that returned early while a scan was running, and nothing re-armed
  it when the scan finished. A needle refinement starts a scan, so the rows
  stayed clamped to one preview per role indefinitely — the reader could raise
  Turns/session, see the "+" control still offered, and never get the turns.
  Instrumented in the browser: the last run of that effect logged
  `running=true compacted=quasarneedle layoutKey=quasarneedle cached 2`,
  followed by no further run and no further render. Completion is now
  re-checked when the quiet period elapses instead of gating entry, which is
  what [all-session content search](../topics/all-session-content-search.md)
  already specified.
- A test defect that reads as a product failure. The spec held the first wave
  of content-search requests until four *distinct* sessions had been
  requested, but the client runs exactly four concurrent acquisitions; a wave
  spending two slots on one session held four requests covering three
  sessions, so the release condition could never be met and every later
  request was blocked behind it. The result was an empty list and a 30s
  timeout, attributed to fan-out. It now also releases on the held count,
  which cannot deadlock. Fixture titles additionally carry the viewport, so a
  previous run's catalog entries can no longer satisfy this run's "6 matching"
  selection.

2026-09-18 — the arriving-match layout failure is fixed. "reserves arriving
matches and fits long titles" failed on one viewport in a full-file run
(reserved row height 133.59px measured before the held response was released,
119.59px once the arriving match was visible) while the same test passed when
run alone, which is the shape of a timer race rather than a layout rule.
Cause: the quiet period that permits the settled column was measured from
whenever the timer was last armed, not from completion. A timer armed mid-scan
could come due a few milliseconds after the final match landed, so the row
reflowed in the same breath as the arrival and never held its reservation.
[All-Session Content Search](../topics/all-session-content-search.md) already
says completion alone does not immediately reflow. The effect depends on
`scan.running` again — without the early return that caused the earlier clamp
— so finishing a scan rearms a full 500ms. The file is 13/13 in two
consecutive clean runs.

Same test, second cause, found in the next full-suite run: it reported no
sessions at all, having exceeded its own 15s budget while its inner waits
declared 30s (the siblings in this file set 60s). Catalog discovery of a
just-written fixture file is an asynchronous step of its own, and under the
load of the whole browser suite it can outlast the needle's wait, which then
reads as a search or layout failure. The test now waits for the fixture to be
listed before typing and carries the 60s budget its inner waits assume.

Both fixes above are local-run evidence only. CI at `ffdc3dddf` still stops
`e2e-tests` early on this file in both
[graehl](https://github.com/graehl/yepanywhere/actions/runs/35315091100) and
[kzahel](https://github.com/kzahel/yepanywhere/actions/runs/35314982232):
appended-turn discovery, the copy/typing check, streaming-and-selection on both
viewports, and "reserves arriving matches" on both viewports, each through two
retries at ~31s. The 31s shape is the fixture-discovery wait timing out, not the
reservation assertion, so CI is hitting the discovery latency the local budget
fix only made visible. Whatever makes catalog discovery that slow on a CI runner
is the open question; local runs of this file are 13/13.

Still unresolved from the runs above: the appended-turn discovery
and copy-selection assertions, and whether CI's
browser/runtime versions surface anything these local runs do not. The
deadlock plausibly accounts for several of the recorded failures, but that is
inference from the mechanism, not from a re-run of those CI jobs.

2026-09-19 — unchanged at `489435583` in both
[graehl](https://github.com/graehl/yepanywhere/actions/runs/35474627087) and
[kzahel](https://github.com/kzahel/yepanywhere/actions/runs/35474629486): the
`e2e-tests` job stops at its five-failure limit on this file, with
appended-turn discovery, arriving-match layout and streaming/selection each
failing through their retries at ~31s, the fixture-discovery shape described
above. Android App CI, Server Runtime And SQLite, and Desktop CI passed on
both remotes at that commit, so this file remains the only thing red.

2026-09-20 — one cause found, reproduced locally, and fixed. It accounts for
three of the five CI failures: the appended-turn discovery timeout and
streaming-and-selection on both viewports.

The C-s/C-r field shortcuts and the Ass./User checkboxes are gated on
`SESSION_CONTENT_SEARCH_CAPABILITY`, read from `useVersion()` — a fetch. Until
it answers, `supported` is false, so `SearchHeader`'s shortcut handler returned
without doing anything and the press was gone. Nothing in these tests waits for
that answer, because every assertion before the press (Title checked, Ass.
unchecked) holds in both states. On a loaded CI runner the press lands first and
is dropped:

- "streams matches and preserves explicit selection" then reaches
  `expect(title).not.toBeChecked()` with fields still `["title"]`, because the
  C-r that should have selected the user field never happened and the following
  `user.uncheck()` is a no-op. That is the ~6.3s deterministic failure with
  "Received: checked" through all retries.
- "follows appended turns" waits for a *content* match, which only the dropped
  C-r would have enabled, so it times out at 30s with "element(s) not found".

Reproduced by delaying `**/api/version*` in a local run: both failures appear
with the exact CI error text and timings (31.0s "element(s) not found", 9.0s
"Received: checked"). With the fix and a 1200ms delay both pass, and the
failure snapshot confirms the held press is applied (User C-r checked).

The fix is product-side, matching [early typing
handoff](../topics/early-typing-handoff.md): a shortcut pressed while the
capability answer is still outstanding is held and applied when it arrives, and
discarded if the answer is "unsupported". A user loading /sessions and
immediately pressing C-r was losing the press the same way.

Still open: "reserves arriving matches and fits long titles" on both viewports.

That remainder is load-dependent, which two adjacent commits establish. It
passed at `e914f4468` — a fully green `CI` on both remotes, 282 passed and 7
skipped with the whole browser suite reaching the end for the first time since
this note opened — and failed at `2b5e07f35` through every retry on both
viewports. Those two trees differ only by the deletion of a Markdown file, so no
code change separates them. This note briefly recorded the entry as closed on
the strength of that single green run; that was wrong, and a one-run pass is not
a closure test for a failure of this shape.

The 2026-09-18 conclusion that identical retry snapshots rule out a timer race
was also wrong: retries within one run share that run's load, so agreeing with
each other says nothing about load sensitivity. Compare across runs instead.

What did change for good is the early stop. `e2e-tests` no longer halts at its
five-failure limit after 13 passes, so the ~270 tests it used to skip now run:
`2b5e07f35` reports 279 passed, 2 failed, 3 flaky. The remaining red is two
tests rather than a suite-wide blackout.

New evidence from the run-35474627087 artifacts, which corrects two earlier
readings above:

- The failure is not fixture-discovery latency. The snapshot reports "in 21
  sessions" — which is `candidates.length` — and a local single-file run reports
  the same 21, so the fixture is in the catalog and the count is not
  CI-specific. The list says "No sessions found" with Title checked, so the
  needle did not match the row the client holds.
- All three attempts on both viewports show the identical snapshot, so this is
  not a timer race like the reflow cause fixed on 2026-09-18.

The needle sits at offset ~465 of a ~895-char first user message, past
`SESSION_TITLE_MAX_LENGTH` (120), so `titleMatches` can only reach it through
the `fullTitle`/`initialPrompt` candidate — and that candidate, unlike the
display-title one, is gated on `inTimeRange(session.createdAt, …)`. That makes
the row's `fullTitle`/`initialPrompt` and `createdAt` the fields to establish.
Attempts to confirm this by rewriting the catalog response in a local run were
discarded as untrustworthy: nulling `fullTitle` made the match *succeed*, which
the code cannot explain, so the interception was not taking effect as intended.
Instrument the actual CI row rather than simulating it.

Given the cross-run evidence above, the next step is to capture what the row
actually holds at failure time under CI load — log the candidate strings
`titleMatches` sees for the fixture — rather than to reason further from
snapshots. Two adjacent runs of the same tree disagreeing is the fact to explain.

Also seen at `2b5e07f35`, separate and not this entry: `unit-tests` failed on
`test/logging/stall-recording.test.ts` expecting one `.cpuprofile` and finding
two, and `persistence-native (windows-latest)` failed on kzahel only. Both are
timing-shaped and unrelated to this file.

2026-09-20 — "reserves arriving matches and fits long titles" failed again on
both viewports through every retry at `fa4352ea2`, in both
[graehl](https://github.com/graehl/yepanywhere/actions/runs/35532637392) and
[kzahel](https://github.com/kzahel/yepanywhere/actions/runs/35532635493). That
tree is six commits past `2b5e07f35` and none of them touch All Sessions
search, so this is the same open remainder, not a new cause. `e2e-tests` is
again the only red job on graehl (280 passed, 2 failed) and reached the end of
the suite; `unit-tests` passed this time, so the `stall-recording` double
`.cpuprofile` noted above did not repeat.

This run's artifacts eliminate the time-range hypothesis recorded above. The
failure snapshot shows both age fields empty, so `after` and `before` are
undefined and `inTimeRange` returns `true` without reading `createdAt` at all —
the `fullTitle`/`initialPrompt` candidate is in `candidates` either way. What
remains is that the candidate strings the row holds do not contain the needle,
which is the field question, not the gate question. The assertion that fails is
`.session-list-item--card` count 0 held for the full 30s, while the preceding
wait for the fixture's link succeeded: the session is listed, and its title
candidates still do not match.

Nothing here supports "load-dependent". Six attempts across two viewports
produced the identical snapshot, which is what a deterministic content
condition looks like, and the earlier cross-commit flip establishes only that
no code difference explains it. The next step is unchanged and now sharper:
make the spec dump the row it holds for the fixture when the count is 0, so one
CI run says whether `fullTitle`/`initialPrompt` reached the client truncated,
empty, or absent.

2026-09-20, later — the row's contents are not the cause, and the catalog is
not the place to look. At `ed0ed3151` the spec printed what it holds on all
three desktop attempts
([graehl](https://github.com/graehl/yepanywhere/actions/runs/35536404989)):

```
listed:true catalogSize:21 title:{length:120,hasNeedle:false}
customTitle:absent fullTitle:{length:897,hasNeedle:true}
initialPrompt:{length:897,hasNeedle:true} createdAt:<present> messageCount:262
```

That is identical to a local run, field for field. The server delivered the
needle to the client in both candidates that can carry it, the session was
listed among the same 21 sessions, and the client still rendered zero cards for
30s. So every hypothesis about truncation, an empty-summary placeholder, a cold
index, `createdAt`, or discovery latency is dead: the data arrived.

Also new: the phone variant passed in this run (2.6s) while desktop failed all
three attempts. Earlier runs failed both, so the failure is not viewport-wide
and not fixed to one viewport either.

What remains is client-side, between a catalog row that contains the needle and
a rendered list that shows none. The list request the page makes carries `q`,
and the server filters on `title`/`customTitle`/`projectName`/`initialPrompt`
itself (`routes/global-sessions.ts`), so the next thing to establish is which
response the rendering list actually held: a fresh filtered page, or a retained
collection answered `unchanged` against a generation token that the fixture's
arrival never advanced. That failure mode has precedent in this repo — the
Projects filter had exactly it, fixed in `6ec6cd3b5`.

2026-09-20, resolved to a cause — and the entry above asked the wrong
question. The Playwright trace for the first failing run's retry was in the
uploaded artifact all along, one directory over from the screenshot that had
been read instead. It holds the request the page actually made:

```
GET /api/sessions?summaryMode=retained&limit=500&includeArchived=true
```

One request, and no `q`. The fixture's row in that response carries only
`autoResumeDisabled, hasUnread, id, isArchived, isStarred, nonHumanUserTurn,
ownership, projectId, projectName, provider, title, updatedAt` — a 120-character
`title` without the needle, and **no `fullTitle`, no `initialPrompt`, no
`createdAt`**. `titleMatches` therefore has no candidate that can contain a
needle sitting at offset ~465, so it returns nothing, every time, on every
attempt. Nothing about load, timers or discovery.

The instrumentation added for this question fetched `/api/sessions?limit=500`
— the unretained path — and so reported the 897-character `fullTitle` and
`initialPrompt` both keeping the needle, in CI exactly as locally. That is a
true answer to a question the page never asks, and the entry above drew the
wrong conclusion from it ("the data arrived"). It arrived on the probed path,
not on the rendered one.

The product consequence is larger than the test. Whenever the list is answered
from a retained collection, All Sessions can only match the first 120
characters of a session's title, so a match living deeper in that session's
first message is invisible to the reader too — intermittently, according to
whether a retained collection exists for the query at that moment. That is the
same local/CI split this note has been chasing: the retained path is taken in
CI and not in the local runs. The contract to reconcile is
[All-Session Content Search](../topics/all-session-content-search.md): either
the retained projection carries the fields title matching needs, or matching
must not be attempted against rows that lack them.

The trace that answered this was already in the artifact, in the retry
directory beside the screenshot that had been read instead; `on-first-retry`
plus CI's two retries had produced it all along. Switching to
`retain-on-failure` to also cover the first attempt was tried and reverted: it
records every test, and its injected recorder script is blocked in a sandboxed
`srcdoc` frame, which `mockup-export.spec.ts` counts as a console problem and
fails on. A local failure still has no trace, since local runs do not retry —
rerun the spec with `--trace on`.

2026-09-20, fixed. Searches match the session's whole text; truncation is a
display decision taken last. The retained path violated that:

- the collection catalog adapter stored `summary.title`, already cut to 120
  characters by its reader, so the retained row's only text was a display
  form;
- `readClaudeCatalogTitle` truncated its own result for the same row; and
- the retained projection sent that one field on, with `initialPrompt` set
  only from hot metadata — present for sessions YA has a metadata record for,
  absent for a freshly written fixture, which is the whole local/CI split.

Now the catalog stores the untruncated text (bounded by
`SESSION_CATALOG_TITLE_MAX_LENGTH`, the limit it already validated against),
and the retained projection sends `fullTitle` plus an `initialPrompt` that
falls back to it, with a display-length `title` beside them — the same pair
the unretained collection already sent. A client-side search now has the words
to match without directing a server-side search.

Covered by `test/routes/retained-session-collections.test.ts`: a retained row
built with no metadata service keeps the whole title in `fullTitle` and
`initialPrompt` while `title` is the truncated form. The test that asserted
retained rows must *not* carry `initialPrompt` encoded the defect and now
asserts the words come along; transcript detail such as `messageCount` still
stays out.

Confirmed green in CI at `6b58140ad`
([graehl](https://github.com/graehl/yepanywhere/actions/runs/35540768245)):
`e2e-tests` passed, so the whole browser suite including both viewports of the
arriving-match test is green for the first time since this note opened. Unlike
the false closure recorded above, this pass comes with a mechanism and a unit
test, so it is evidence about a fix rather than about one run's luck — but the
shape of this failure earned a second confirming run before the entry is
retired.

That second run landed on the same commit:
[kzahel](https://github.com/kzahel/yepanywhere/actions/runs/35540766749) also
reports `e2e-tests` success. Two runners, two independent passes, with a known
cause and a unit test behind them. The arriving-match failure this file was
opened for is closed.

What keeps the file open is the smaller thread it also tracks: "preserves
copying and returns to the query end only when typing", which failed once and
passed on retry at `fa4352ea2` on kzahel while graehl passed it outright, and
whose 2026-09-15 copy-selection assertion was never explained. Retire this file
once that is either explained or seen to stay green.

Two adjacent observations that are not this entry. On kzahel the same run also
failed `provider-host-native (windows-latest)` with `kill EPERM` during process
teardown; graehl's identical tree passed that job, so it is host-shaped. And
kzahel recorded "preserves copying and returns to the query end only when
typing" as flaky — failed once, passed on retry #1 — where graehl passed it
outright.

Found 2026-09-15 while reporting source CI after publishing the catch-up fix.
Contributing-model: 6-Astra
Contributing-model: Opus 5
