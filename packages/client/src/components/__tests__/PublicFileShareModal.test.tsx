// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { I18nProvider } from "../../i18n";
import { PublicFileShareModal } from "../PublicFileShareModal";
import type { FileVhostService } from "../FileVhostSection";

const access = vi.hoisted(() => ({
  canUseBearerGrants: true,
  vhostService: null as FileVhostService | null,
}));

vi.mock("../../hooks/useActingPrincipal", () => ({
  useCanUseBearerGrants: () => access.canUseBearerGrants,
}));
vi.mock("../../hooks/useFileVhostService", () => ({
  useFileVhostService: () => access.vhostService,
}));

const publicUrl =
  "https://ya.example/share/file-secret/file?h=relay&path=docs%2Fguide.md";

describe("PublicFileShareModal", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    access.canUseBearerGrants = true;
    access.vhostService = null;
    vi.spyOn(api, "getPublicFileShares").mockResolvedValue({ items: [] });
    vi.spyOn(api, "createPublicFileShare").mockResolvedValue({
      url: publicUrl,
      shareId: "share-one",
      createdAt: "2026-08-28T00:00:00.000Z",
      secretBits: 128,
    });
    vi.spyOn(api, "revokePublicFileShare").mockResolvedValue({
      revoked: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    writeText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("creates and copies a live link for the exact file", async () => {
    render(
      <I18nProvider>
        <PublicFileShareModal
          projectId="cHJvamVjdA"
          filePath="docs/guide.md"
          title="guide.md"
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Create and copy live link" }),
    );

    await waitFor(() => {
      expect(api.createPublicFileShare).toHaveBeenCalledWith({
        projectId: "cHJvamVjdA",
        path: "docs/guide.md",
        title: "guide.md",
      });
      expect(writeText).toHaveBeenCalledWith(publicUrl);
    });
  });

  it("says so and copies the play form when links open in play mode", async () => {
    const shareUrl =
      "https://ya.example/share/file-secret/file?h=relay&projectId=cHJvamVjdA&path=site%2Findex.html";
    vi.mocked(api.createPublicFileShare).mockResolvedValue({
      url: shareUrl,
      shareId: "share-one",
      createdAt: "2026-08-28T00:00:00.000Z",
      secretBits: 128,
    });
    const { rerender } = render(
      <I18nProvider>
        <PublicFileShareModal
          projectId="cHJvamVjdA"
          filePath="site/index.html"
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );
    const notice =
      "Interactive preview is running: copied links open the document in play mode.";
    expect(screen.queryByText(notice)).toBeNull();

    rerender(
      <I18nProvider>
        <PublicFileShareModal
          projectId="cHJvamVjdA"
          filePath="site/index.html"
          playLinks
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText(notice)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Create and copy live link" }),
    );
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "https://ya.example/play.html?h=relay&projectId=cHJvamVjdA&path=site%2Findex.html#share=file-secret",
      );
    });
  });

  it("offers limited users file addresses without requesting bearer shares", async () => {
    access.canUseBearerGrants = false;
    const list = vi.fn().mockResolvedValue([]);
    access.vhostService = {
      hostSuffix: "example.org",
      canReplace: true,
      canUsePrivateLinks: false,
      list,
      serve: vi.fn(),
      stop: vi.fn(),
    };
    render(
      <I18nProvider>
        <PublicFileShareModal
          projectId="cHJvamVjdA"
          filePath="docs/guide.md"
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );
    await screen.findByRole("checkbox", {
      name: "Replace an existing mapping with this name",
    });
    expect(list).toHaveBeenCalledWith("docs/guide.md");
    expect(api.getPublicFileShares).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Create and copy live link" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Require the link" }),
    ).toBeNull();
  });

  it("confirms before revoking a link", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.getPublicFileShares).mockResolvedValue({
      items: [
        {
          shareId: "share-one",
          url: publicUrl,
          title: "guide.md",
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z",
        },
      ],
    });
    render(
      <I18nProvider>
        <PublicFileShareModal
          projectId="cHJvamVjdA"
          filePath="docs/guide.md"
          onClose={vi.fn()}
        />
      </I18nProvider>,
    );

    const revoke = await screen.findByRole("button", {
      name: "Revoke public file link",
    });
    expect(screen.getByRole("img", { name: "Live" })).toBeTruthy();
    fireEvent.click(revoke);
    expect(window.confirm).toHaveBeenCalledWith(
      "Revoke this public link? Anyone using it will immediately lose access.",
    );
    await waitFor(() => {
      expect(api.revokePublicFileShare).toHaveBeenCalledWith("share-one");
    });
  });
});
