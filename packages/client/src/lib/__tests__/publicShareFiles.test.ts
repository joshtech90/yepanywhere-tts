import { type FileContentResponse, toUrlProjectId } from "@yep-anywhere/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPublicShareFileRoutePath,
  fetchPublicShareRawFileBlob,
  normalizePublicShareFilePath,
} from "../publicShareFiles";
import { fetchPublicShareBlobViaRelay } from "../publicShareRelay";

vi.mock("../publicShareRelay", () => ({
  fetchPublicShareBlobViaRelay: vi.fn(async () => new Blob(["relayed"])),
}));

const projectId = toUrlProjectId("/repo");
const attachmentPath =
  "/home/me/.yep-anywhere/projects/0123456789abcdef0123456789abcdef/attachments/session-a/photo.png";

describe("normalizePublicShareFilePath", () => {
  it("keeps mentioned app-data attachment paths as share file links", () => {
    expect(normalizePublicShareFilePath(attachmentPath, projectId)).toEqual({
      path: attachmentPath,
    });
    expect(
      normalizePublicShareFilePath(
        "~/.yep-anywhere/projects/0123456789abcdef0123456789abcdef/attachments/session-a/photo.png",
        projectId,
      ),
    ).toEqual({
      path: "~/.yep-anywhere/projects/0123456789abcdef0123456789abcdef/attachments/session-a/photo.png",
    });
  });

  it("still rejects other absolute paths", () => {
    expect(normalizePublicShareFilePath("/etc/passwd", projectId)).toBeNull();
  });

  it("still rewrites in-project paths to project-relative", () => {
    expect(normalizePublicShareFilePath("/repo/README.md", projectId)).toEqual({
      path: "README.md",
    });
  });
});

describe("public share file routes", () => {
  const grant = {
    relayUrl: "wss://relay.example/ws",
    relayUsername: "host",
    secret: "s/cret",
    viewerId: "viewer-1",
    projectId,
  };

  afterEach(() => {
    vi.mocked(fetchPublicShareBlobViaRelay).mockClear();
  });

  it("puts the path and viewer before the route's own query", () => {
    expect(
      buildPublicShareFileRoutePath(grant, "content", "a b.md", {
        line: "3",
      }),
    ).toBe(
      "/public-api/shares/s%2Fcret/files?path=a+b.md&viewerId=viewer-1&line=3",
    );
    expect(
      buildPublicShareFileRoutePath({ secret: "s" }, "raw", "img/x.png"),
    ).toBe("/public-api/shares/s/files/raw?path=img%2Fx.png");
  });

  it("reads a file by its share-relative path, and only inside the share", async () => {
    await fetchPublicShareRawFileBlob(grant, null, "/repo/img/x.png");
    expect(fetchPublicShareBlobViaRelay).toHaveBeenCalledWith({
      relayUrl: grant.relayUrl,
      relayUsername: grant.relayUsername,
      path: "/public-api/shares/s%2Fcret/files/raw?path=img%2Fx.png&viewerId=viewer-1",
    });
    await expect(
      fetchPublicShareRawFileBlob(grant, null, "/etc/passwd"),
    ).rejects.toThrow("File is outside this public share");
    expect(fetchPublicShareBlobViaRelay).toHaveBeenCalledTimes(1);
  });

  it("uses media the referencing document embeds without a request", async () => {
    const blob = await fetchPublicShareRawFileBlob(
      grant,
      {
        embeddedMedia: {
          "img/x.png": { data: btoa("png"), mimeType: "image/png" },
        },
      } as Partial<FileContentResponse> as FileContentResponse,
      "/repo/img/x.png",
    );
    expect(blob.type).toBe("image/png");
    expect(fetchPublicShareBlobViaRelay).not.toHaveBeenCalled();
  });
});
