import type { FileHandle } from "node:fs/promises";

/** Own an authorized descriptor with one bounded chunk of read-ahead. */
export function openedFileStream(
  handle: FileHandle,
  start: number,
  end: number,
): ReadableStream<Uint8Array> {
  let position = start;
  let cancelled = false;
  let closing: Promise<void> | undefined;
  const close = () => {
    // FileHandle.close waits for any admitted read before closing the fd.
    closing ??= handle.close();
    return closing;
  };
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (position > end) {
            await close();
            if (!cancelled) controller.close();
            return;
          }
          const bytes = new Uint8Array(Math.min(64 * 1024, end - position + 1));
          const { bytesRead } = await handle.read(
            bytes,
            0,
            bytes.length,
            position,
          );
          // Cancellation can close the controller during filesystem I/O.
          if (cancelled) return;
          if (bytesRead === 0)
            throw new Error("File ended before response length");
          position += bytesRead;
          const ended = position > end;
          if (ended) await close();
          if (cancelled) return;
          controller.enqueue(bytes.subarray(0, bytesRead));
          if (ended) controller.close();
        } catch (error) {
          if (cancelled) return;
          await close().catch(() => {});
          controller.error(error);
        }
      },
      cancel() {
        cancelled = true;
        return close();
      },
    },
    { highWaterMark: 1 },
  );
}
