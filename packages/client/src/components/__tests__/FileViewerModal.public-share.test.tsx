// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { toUrlProjectId } from "@yep-anywhere/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicShareProvider } from "../../contexts/PublicShareContext";
import { I18nProvider } from "../../i18n";
import { fetchPublicShareJsonViaRelay } from "../../lib/publicShareRelay";
import { FileViewerModal } from "../FilePathLink";

vi.mock("../../lib/publicShareRelay", () => ({
  fetchPublicShareBlobViaRelay: vi.fn(),
  fetchPublicShareJsonViaRelay: vi.fn(),
}));

const fetchJsonMock = vi.mocked(fetchPublicShareJsonViaRelay);

describe("FileViewerModal inside a public share", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /**
   * Share transcripts carry project-file anchors, and a click on one opens this
   * modal without naming a source. Defaulting to the authenticated project file
   * API makes the share viewer answer "API error: 404", because a share
   * connection may only read `/public-api/shares/...`.
   */
  it("reads through the share's own file endpoint when given no source", async () => {
    const projectId = toUrlProjectId("/local/graehl/xmt");
    fetchJsonMock.mockResolvedValue({
      metadata: {
        path: "gaps/thresholds.md",
        size: 4,
        mimeType: "text/markdown",
        isText: true,
      },
      rawUrl: "",
      content: "gap\n",
    });

    render(
      <I18nProvider>
        <PublicShareProvider
          value={{
            projectId,
            relayUrl: "wss://relay.example/ws",
            relayUsername: "shared-host",
            secret: "share-secret",
            viewerId: "viewer-token-1",
          }}
        >
          <FileViewerModal
            projectId={projectId}
            filePath="gaps/thresholds.md"
            onClose={() => {}}
          />
        </PublicShareProvider>
      </I18nProvider>,
    );

    await vi.waitFor(() => expect(fetchJsonMock).toHaveBeenCalled());
    const request = fetchJsonMock.mock.calls[0]![0];
    expect(request.path).toContain(
      "/public-api/shares/share-secret/files?path=gaps",
    );
    expect(request.path).toContain("viewerId=viewer-token-1");
    expect(request.relayUrl).toBe("wss://relay.example/ws");
    expect(await screen.findByTitle("gaps/thresholds.md")).toBeTruthy();
  });
});
