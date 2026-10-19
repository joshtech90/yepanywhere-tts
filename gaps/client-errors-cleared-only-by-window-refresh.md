# A file-viewer download failed with "Failed to fetch" until the window was refreshed

Reported by the user on 2026-10-13 (direct observations): in the file viewer,
Download for
`/local/graehl/trtllm-speculative/pii-software-v1.5/software-v1.5.tgz`
(19.3 MB; the file exists, and the viewer showed its type and size) failed
with the toast "Could not download software-v1.5.tgz: Failed to fetch".
Refreshing the browser window cleared it; a full restart of YA and its provider
hosts did not, so the faulty state lives in the client page.

The same report had two companions, now resolved:

- Sends with an attachment stayed in the composer after delivery. That was
  two tabs of one session echoing attachment state through shared storage
  (see [draft synchronization](../topics/draft-synchronization.md), sibling
  tabs); it reproduces on localhost and over the relay, and is fixed with a
  regression check.
- The "database" error toasts were the recent-uploads store failing on a
  connection the browser had closed, fixed by `b16af8b22`.

## What is known about the download

"Failed to fetch" is the message of a rejected browser `fetch`, and the toast
comes only from `useSaveResourceDownload`
(`packages/client/src/components/FileResourceActions.tsx`) when its transport
fetch rejects. Checked 2026-10-13 against current code, neither ordinary
transport should produce it:

- On a direct (same-origin) client the viewer hands `directUrl` to the
  browser's own download, so no toast is possible.
- On the relay client, `fetchStream` and `fetchResponse` travel inside the
  relay socket (`RelayProtocol`), and the relay mux pool's one browser `fetch`
  (its health discovery) swallows its errors.

So which window, transport and code path produced the toast is unknown. The
streamed-download handoff to the service worker
(`packages/client/src/lib/streamedDownload.ts`, `public/sw.js`) holds
page-lifetime state and is the next candidate to check.

## Discriminating checks

When it recurs, before refreshing: note the window's URL (direct or
ya.graehl.org), capture the browser console and the failing request in the
network panel, and whether a service worker controls the page
(`navigator.serviceWorker.controller`). Client diagnostics
(`packages/client/src/lib/diagnostics/`) were not uploading on 2026-10-13, so
enable them if the failure needs to be caught unattended.

Related open gap: [session-path download start delay](session-path-download-start-delay.md).

Found 2026-10-13 while downloading release archives through YA's file viewer.
