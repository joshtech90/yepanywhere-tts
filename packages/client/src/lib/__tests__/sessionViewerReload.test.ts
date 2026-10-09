import { afterEach, describe, expect, it } from "vitest";
import {
  clearCurrentSessionViewer,
  closeSessionViewer,
  minimizeSessionViewer,
  presentSessionViewer,
} from "../sessionViewerController";
import {
  readReloadedSessionFile,
  saveReloadedSessionFileScroll,
  trackReloadedSessionFile,
} from "../sessionViewerReload";

const route = "/projects/p/file?path=README.md";

function present(id: string) {
  presentSessionViewer({
    id,
    kind: "file",
    sessionId: "s1",
    label: "README.md",
    filePath: "README.md",
    lineSuffix: "",
    onClose: () => {},
  });
}

describe("sessionViewerReload", () => {
  afterEach(() => {
    clearCurrentSessionViewer();
    sessionStorage.clear();
  });

  it("keeps an open viewer's minimized state and scroll for a reload", () => {
    trackReloadedSessionFile("s1", "v1", route);
    present("v1");
    saveReloadedSessionFileScroll("s1", "v1", 420);
    minimizeSessionViewer("v1");
    expect(readReloadedSessionFile("s1")).toEqual({
      route,
      minimized: true,
      scrollTop: 420,
    });
  });

  it("keeps a saved record when the reopened viewer tracks its route", () => {
    // What a reload leaves: a record no viewer in this page has tracked yet.
    sessionStorage.setItem(
      "yep-anywhere-session-open-file:s2",
      JSON.stringify({ route, minimized: true, scrollTop: 900 }),
    );
    trackReloadedSessionFile("s2", "v9", route);
    expect(readReloadedSessionFile("s2")).toEqual({
      route,
      minimized: true,
      scrollTop: 900,
    });
  });

  it("forgets the viewer on Close, so a reload opens nothing", () => {
    trackReloadedSessionFile("s1", "v1", route);
    present("v1");
    closeSessionViewer("v1");
    expect(readReloadedSessionFile("s1")).toBeNull();
  });

  it("follows a replacing file and ignores the replaced viewer's scroll", () => {
    trackReloadedSessionFile("s1", "v1", route);
    present("v1");
    const next = "/projects/p/file?path=other.md";
    trackReloadedSessionFile("s1", "v2", next);
    present("v2");
    saveReloadedSessionFileScroll("s1", "v1", 99);
    expect(readReloadedSessionFile("s1")).toEqual({
      route: next,
      minimized: false,
      scrollTop: undefined,
    });
  });
});
