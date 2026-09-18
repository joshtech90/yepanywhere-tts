// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicShareProvider } from "../../contexts/PublicShareContext";
import { I18nProvider } from "../../i18n";
import { FileViewer, type FileViewerSource } from "../FileViewer";

vi.mock("../../hooks/useFileVersionControl", () => ({
  useFileVersionControl: () => ({ loading: false, relativePath: null }),
}));

const source: FileViewerSource = {
  loadFile: async () => ({
    metadata: {
      path: "gaps/thresholds.md",
      size: 4,
      mimeType: "text/markdown",
      isText: true,
    },
    rawUrl: "",
    content: "gap\n",
  }),
};

function installClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe("FileViewer copy viewer link button", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("copies the authenticated viewer URL outside a share", async () => {
    const writeText = installClipboard();
    render(
      <I18nProvider>
        <FileViewer
          projectId="project-id"
          filePath="gaps/thresholds.md"
          source={source}
        />
      </I18nProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Copy viewer link" }),
    );
    expect(await screen.findByTitle("Copied!")).toBeTruthy();
    expect(writeText.mock.calls[0]![0]).toContain(
      "/projects/project-id/file?path=gaps%2Fthresholds.md",
    );
  });

  /**
   * A share reader cannot open `/projects/:id/file`, so the link this button
   * hands them has to be the share's own route even when the viewer was opened
   * from a transcript anchor that supplied no explicit URL.
   */
  it("copies the share's own viewer URL inside a public share", async () => {
    const writeText = installClipboard();
    const projectId = toUrlProjectId("/local/graehl/xmt");
    render(
      <I18nProvider>
        <PublicShareProvider
          value={{
            projectId,
            relayUrl: "wss://relay.example/ws",
            relayUsername: "shared-host",
            secret: "share-secret",
          }}
        >
          <FileViewer
            projectId={projectId}
            filePath="gaps/thresholds.md"
            source={source}
          />
        </PublicShareProvider>
      </I18nProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Copy viewer link" }),
    );
    expect(await screen.findByTitle("Copied!")).toBeTruthy();
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied).toContain("/share/share-secret/file");
    expect(copied).toContain("path=gaps%2Fthresholds.md");
    expect(copied).not.toContain("/projects/");
  });
});
