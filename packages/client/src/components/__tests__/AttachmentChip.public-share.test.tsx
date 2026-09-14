import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicShareProvider } from "../../contexts/PublicShareContext";
import { I18nProvider } from "../../i18n";
import { fetchPublicShareBlobViaRelay } from "../../lib/publicShareRelay";
import { AttachmentChip } from "../AttachmentChip";

vi.mock("../../lib/publicShareRelay", () => ({
  fetchPublicShareBlobViaRelay: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("public share attachments", () => {
  it("opens an image through the bearer share without a private upload request", async () => {
    const attachmentPath =
      "/app-data/projects/0123456789abcdef0123456789abcdef/attachments/source-session/12345678-1234-1234-1234-123456789abc_image.png";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = vi.fn(() => "blob:shared-attachment");
        static revokeObjectURL = vi.fn();
      },
    );
    vi.mocked(fetchPublicShareBlobViaRelay).mockResolvedValue(
      new Blob(["image"], { type: "image/png" }),
    );
    const { unmount } = render(
      <I18nProvider>
        <PublicShareProvider
          value={{
            projectId: "L3Byb2plY3Q",
            relayUrl: "wss://relay.example/ws",
            relayUsername: "owner",
            secret: "public-secret",
            viewerId: "viewer-123",
          }}
        >
          <AttachmentChip
            originalName="image.png"
            path={attachmentPath}
            mimeType="image/png"
            sizeLabel="1 KB"
          />
        </PublicShareProvider>
      </I18nProvider>,
    );
    expect(fetchPublicShareBlobViaRelay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open image.png" }));
    await waitFor(() => {
      expect(
        screen.getByRole("img", { name: "image.png" }).getAttribute("src"),
      ).toBe("blob:shared-attachment");
    });
    expect(fetchPublicShareBlobViaRelay).toHaveBeenCalledWith({
      relayUrl: "wss://relay.example/ws",
      relayUsername: "owner",
      path: `/public-api/shares/public-secret/files/raw?${new URLSearchParams({ path: attachmentPath, viewerId: "viewer-123" })}`,
    });
    expect(fetch).not.toHaveBeenCalled();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:shared-attachment");
  });
});
