# Project Queue titles are read through provider resolution, not the catalog

`topics/project-queue.md` § Quiet Window says existing-session titles come
from the compact session catalog plus YA metadata, and that repeated queue
reads with unchanged state do no provider or session-index-miss work. The
queue responses (`packages/server/src/routes/project-queue-response.ts`)
instead title both existing-session items (`enrichProjectQueueItem`) and
blocker sessions (`addBlockerSessionTitles`) through
`findSessionListSummaryAcrossProviders`, which tries each provider source
and falls back to the provider reader on an index miss. A session whose
summary stays uncached is therefore read again on every queue GET.

F109 bounded the blocker half (titles only for the three named blockers,
projects resolved concurrently) but kept the resolver. The queue route deps
(`createGlobalProjectQueueRoutes` / `createProjectQueueRoutes` in `app.ts`)
carry no `SessionCatalogService`, and the catalog exposes project rows, not a
by-session lookup, so the fix needs a catalog title read wired into those
deps (or the topic's promise narrowed).

Found 2026-09-27 while fixing harsh-review item [13-5] (F109).
