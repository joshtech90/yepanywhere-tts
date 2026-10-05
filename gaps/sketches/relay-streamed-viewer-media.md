# Stream relay viewer media instead of holding it in a Blob

Relay responses now stream
([relay transfer size](../../topics/media-rendering-and-routing.md#relay-transfer-size)):
downloads go to disk through the service worker, and `fetchBlob` reads the
stream without base64 or a size limit. Viewers still collect the whole file
into a `Blob` before showing it. A relay video or PDF therefore waits for its
last byte before it plays or renders, and the page holds all of it for as
long as the viewer is open.

Sketch:

- Serve viewer media from the same service-worker route as downloads, inline
  rather than as an attachment. A `<video>` element issues `Range` requests,
  so the worker would map each range to a relayed `GET` carrying a `Range`
  header and stream that part. The raw file routes already answer `Range`.
- That needs the streamed request to forward `Range` and return `206` with
  `Content-Range`. Today the relay forwards only `x-*`, `content-type`,
  `etag`, `location` and `server-timing` response headers.
- A worker URL has a lifetime the page must manage: one registration per open
  viewer, released when the viewer closes, and none left behind after a
  reload.
- Without a controlling service worker, keep today's `Blob`.

Found 2026-10-03 while closing `gaps/chrome-client-blob-buffering.md`;
narrowed to viewer media on 2026-10-04 when streamed downloads landed.
