# A finished `!!` run keeps saying "running…" until the page is reloaded

The server finishes a bang command and records it correctly; the live page
never learns. Reproduced 3/3 in the browser harness with
`!!echo ya-bang-N`:

- the block shows `!! | echo ya-bang-1 | running… | Cancel | Recall` and still
  says that three seconds later (and indefinitely — a 60s wait for the
  finished-only Delete action times out);
- reloading the same page shows
  `!! | echo ya-bang-1 | exit 0 | 11ms | ya-bang-1 | Load output | Recall |
  Re-run | Echo to session | Delete`.

So the run really did exit 0 in 6–11 ms and
`SessionMetadataService` has it; what is missing is the client applying the
completion. `BangCommandService.emitObjects` emits `session-metadata-changed`
with the updated `transcriptDisplayObjects`
(`packages/server/src/services/BangCommandService.ts:585`), and `useSession`
applies that field when the event arrives
(`packages/client/src/hooks/useSession.ts:1662`), so the break is between
those two: either the event is not delivered to this page, or it is delivered
and dropped. Not yet diagnosed further.

User-visible cost: every action gated on `finished` — Delete, Re-run, Echo to
session, Load output — stays hidden for a command that has already finished,
and the block advertises a Cancel that would do nothing. A reload is the only
way out.

`packages/client/e2e/bang-command.spec.ts` covers the run end to end and has
to reload before asserting the finished state; when this is fixed, drop that
reload and assert the finished block directly, which is the real contract.

Not fixed in place: the adjacent work was adding that first bang e2e test, and
this needs the event path traced from the server's emit to the page's stream
subscription rather than a guess.

Found 2026-09-20 while writing the first e2e coverage for `!!` commands.
