# Browser upload interruption also rejects an unobserved promise

The October 7 lifecycle runner's `upload-interruption` experiment cuts a real
4 MiB upload after 256 KiB of client traffic. Both direct and mux remote web
clients show the expected upload-failed notice and preserve the typed draft;
after connection recovery, explicitly selecting the file again produces one
completed chip. However, the page also emits an uncaught
`WebSocket closed with code 1006` rejection.

`RelayProtocol.uploadStagedAttachment` creates its completion promise before
streaming chunks and awaits it only after sending the end frame. Closing the
connection rejects that promise while `sendUploadChunk` can separately throw;
the catch then leaves without ever awaiting the completion rejection. The
session's outer upload handler catches the chunk failure, so that user-facing
notice does not account for the uncaught rejection. The ordinary upload path
has the same structure and needs review too.

Reduce this to an owning-layer regression before repairing promise observation
and reader cleanup. Preserve the explicit upload failure and manual retry;
never turn this into automatic replay of ambiguous writes. This is an adjacent
standard-web defect, kept separate from the Android-focused recovery repairs.

Reproduce with the lifecycle runner: `--client=browser --route=direct
--surface=session --fault=upload-interruption --observe-ms=15000` (also mux).
The diagnostic intentionally does not pass the generic no-error page oracle;
its result records the action-specific evidence and uncaught exception.

The same failure reproduces in stock emulator Chrome on both routes. The
real native Android app completes the same explicit-failure/reselection
experiments with no uncaught page exception or synthetic server response.

Found 2026-10-07 while extending Android lifecycle comparisons to uploads.
