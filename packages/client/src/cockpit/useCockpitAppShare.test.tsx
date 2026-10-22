import { cleanup, render, waitFor } from "@testing-library/react";
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
}: {
  onText: (text: string) => void;
  onFiles: (files: File[]) => void;
}) {
  useCockpitAppShare(onText, onFiles);
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
    window.__yepAppShare = [{ text: "  Link https://example.org  " }];

    render(<Receiver onText={onText} onFiles={onFiles} />);
    expect(onText).toHaveBeenCalledWith("Link https://example.org");

    window.__yepAppShare.push({
      files: [
        { url: "/__yep_app/teilen/abc/0", name: "foto.png", type: "image/png" },
        { url: "https://evil.example/x", name: "x" },
      ],
    });
    window.dispatchEvent(new Event(COCKPIT_APP_SHARE_EVENT));

    await waitFor(() => expect(onFiles).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/__yep_app/teilen/abc/0");
    const [files] = onFiles.mock.calls[0] as [File[]];
    expect(files.map((file) => [file.name, file.type])).toEqual([
      ["foto.png", "image/png"],
    ]);
    expect(window.__yepAppShare).toEqual([]);
  });
});
