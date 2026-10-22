import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COCKPIT_APP_SHARE_EVENT,
  useCockpitAppShare,
} from "./useCockpitAppShare";

afterEach(() => {
  cleanup();
  delete window.__yepAppShare;
  vi.unstubAllGlobals();
});

function Receiver({
  onText,
  onFiles,
  onMissing,
  enabled = true,
}: {
  onText: (text: string) => void;
  onFiles: (files: File[]) => void;
  onMissing: (count: number) => void;
  enabled?: boolean;
}) {
  useCockpitAppShare(onText, onFiles, onMissing, enabled);
  return null;
}

describe("useCockpitAppShare", () => {
  // Contract with packages/android-cockpit (Teilen.kt): the app may queue a
  // share before "New session" mounts or dispatch it afterwards, and only its
  // own /__yep_app/ files may be fetched.
  it("takes queued and dispatched shares, fetching only app-served files", async () => {
    const fetchMock = vi.fn(
      async (_url: string) =>
        new Response(new Blob(["png"], { type: "image/png" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onText = vi.fn();
    const onFiles = vi.fn();
    const onMissing = vi.fn();
    window.__yepAppShare = [{ text: "  Link https://example.org  " }];

    render(
      <Receiver onText={onText} onFiles={onFiles} onMissing={onMissing} />,
    );
    expect(onText).toHaveBeenCalledWith("Link https://example.org");

    window.__yepAppShare.push({
      files: [
        { url: "/__yep_app/teilen/abc/0", name: "foto.png", type: "image/png" },
        { url: "https://evil.example/x", name: "x" },
      ],
      missing: 1,
    });
    window.dispatchEvent(new Event(COCKPIT_APP_SHARE_EVENT));

    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/__yep_app/teilen/abc/0");
    const [files] = onFiles.mock.calls[0] as [File[]];
    expect(files.map((file) => [file.name, file.type])).toEqual([
      ["foto.png", "image/png"],
    ]);
    // The rejected foreign URL and the file the app could not copy are
    // reported, so the text never arrives silently without its attachments.
    expect(onMissing).toHaveBeenCalledWith(2);
    expect(window.__yepAppShare).toEqual([]);
  });
});

it("keeps a share atomic across navigation and a busy receiver", async () => {
  let resolveFile!: (value: Response) => void;
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFile = resolve;
        }),
    )
    .mockResolvedValue(new Response(new Blob(["file"])));
  vi.stubGlobal("fetch", fetchMock);
  const callbacks = { onText: vi.fn(), onFiles: vi.fn(), onMissing: vi.fn() };
  window.__yepAppShare = [
    {
      text: "Shared message",
      files: [{ url: "/__yep_app/teilen/id/0", name: "notes.txt" }],
    },
  ];
  const first = render(<Receiver {...callbacks} />);
  expect(callbacks.onText).not.toHaveBeenCalled();
  first.unmount();
  const next = render(<Receiver {...callbacks} enabled={false} />);
  await act(async () => {
    resolveFile(new Response(new Blob(["old"])));
  });
  expect(callbacks.onFiles).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  next.rerender(<Receiver {...callbacks} />);
  await waitFor(() => expect(callbacks.onFiles).toHaveBeenCalledTimes(1));
  expect(callbacks.onText).toHaveBeenCalledExactlyOnceWith("Shared message");
  expect(window.__yepAppShare).toEqual([]);
});
