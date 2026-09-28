import type { FileContentResponse } from "@yep-anywhere/shared";
import { toUrlProjectId } from "@yep-anywhere/shared";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicFileShareRoutes } from "../../src/routes/public-file-shares.js";
import { createPublicSharePublicRoutes } from "../../src/routes/public-shares.js";
import { PublicShareService } from "../../src/services/PublicShareService.js";

describe("public file shares", () => {
  let testDir: string;
  let projectRoot: string;
  let projectId: ReturnType<typeof toUrlProjectId>;
  let service: PublicShareService;
  let files: Map<string, string>;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "public-file-routes-"));
    projectRoot = path.join(testDir, "project");
    await fs.mkdir(projectRoot);
    projectId = toUrlProjectId(projectRoot);
    service = new PublicShareService({ dataDir: testDir });
    await service.initialize();
    files = new Map([
      [
        "docs/guide.md",
        "# Guide\n\n![Diagram](diagram.svg)\n\n[Details](details.md)\n",
      ],
      ["docs/diagram.svg", '<svg><circle r="4" /></svg>'],
      ["docs/next.svg", '<svg><rect width="4" height="4" /></svg>'],
      ["docs/details.md", "private linked document"],
      ["docs/unlinked.svg", "<svg />"],
    ]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  const fetchProjectFile = async (
    _requestedProjectId: string,
    requestedPath: string,
    options: { raw?: boolean },
  ): Promise<Response> => {
    const content = files.get(requestedPath);
    if (content === undefined) {
      return new Response(JSON.stringify({ error: "File not found" }), {
        status: 404,
      });
    }
    if (options.raw) {
      return new Response(content, {
        headers: {
          "Content-Type": requestedPath.endsWith(".svg")
            ? "image/svg+xml"
            : "text/plain",
        },
      });
    }
    const response: FileContentResponse = {
      metadata: {
        path: requestedPath,
        size: Buffer.byteLength(content),
        mimeType: requestedPath.endsWith(".md")
          ? "text/markdown"
          : "image/svg+xml",
        isText: true,
      },
      content,
      rawUrl: `/api/projects/${projectId}/files/raw?path=${encodeURIComponent(
        requestedPath,
      )}`,
    };
    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
    });
  };

  it("creates, lists, and revokes an exact live file grant", async () => {
    const app = createPublicFileShareRoutes({
      publicShareService: service,
      fetchProjectFile,
      getPublicSharesEnabled: () => true,
      getRemoteAccessEnabled: () => true,
      getRelayConfig: () => ({
        url: "wss://relay.example/ws",
        username: "example-host",
      }),
      getYaClientBaseUrl: () => "https://ya.example/",
    });

    const createResponse = await app.request("/public-file-shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        path: "docs/guide.md",
        title: "Guide",
      }),
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as {
      createdAt: string;
      shareId: string;
      url: string;
    };
    const publicUrl = new URL(created.url);
    expect(publicUrl.pathname).toMatch(/^\/share\/[A-Za-z0-9_-]{22}\/file$/);
    expect(publicUrl.searchParams.get("h")).toBe("example-host");
    expect(publicUrl.searchParams.get("projectId")).toBe(projectId);
    expect(publicUrl.searchParams.get("path")).toBe("docs/guide.md");
    expect(publicUrl.searchParams.get("standalone")).toBe("1");
    expect(publicUrl.hash).toBe("#v=2&target=file");

    const listResponse = await app.request(
      `/public-file-shares?projectId=${encodeURIComponent(
        projectId,
      )}&path=docs%2Fguide.md`,
    );
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({
      items: [
        {
          shareId: created.shareId,
          url: created.url,
          title: "Guide",
          createdAt: created.createdAt,
          updatedAt: created.createdAt,
        },
      ],
    });

    const otherPathResponse = await app.request(
      `/public-file-shares?projectId=${encodeURIComponent(
        projectId,
      )}&path=docs%2Fother.md`,
    );
    expect(await otherPathResponse.json()).toEqual({ items: [] });

    const revokeResponse = await app.request(
      `/public-file-shares/${created.shareId}`,
      { method: "DELETE" },
    );
    expect(revokeResponse.status).toBe(200);
    expect(await revokeResponse.json()).toEqual({ revoked: true });
  });

  it("shares an absolute path under the registered project that owns it", async () => {
    const otherRoot = path.join(testDir, "other-project");
    await fs.mkdir(path.join(otherRoot, "build"), { recursive: true });
    await fs.writeFile(path.join(otherRoot, "build", "paper.html"), "<p>x</p>");
    // The existence check reads through the project file fetcher.
    files.set("build/paper.html", "<p>x</p>");
    const app = createPublicFileShareRoutes({
      publicShareService: service,
      fetchProjectFile,
      listProjectRoots: async () => [projectRoot, otherRoot],
      getPublicSharesEnabled: () => true,
      getRemoteAccessEnabled: () => true,
      getRelayConfig: () => ({
        url: "wss://relay.example/ws",
        username: "example-host",
      }),
      getYaClientBaseUrl: () => "https://ya.example/",
    });
    // Viewed from the first project's viewer, the file lives in the other one.
    const created = await app.request("/public-file-shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        path: path.join(otherRoot, "build", "paper.html"),
      }),
    });
    expect(created.status).toBe(200);
    const url = new URL(((await created.json()) as { url: string }).url);
    expect(url.searchParams.get("projectId")).toBe(toUrlProjectId(otherRoot));
    expect(url.searchParams.get("path")).toBe("build/paper.html");
    // The list resolves the same way, so the retained link is found again.
    const listed = await app.request(
      `/public-file-shares?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path.join(otherRoot, "build", "paper.html"))}`,
    );
    expect(((await listed.json()) as { items: unknown[] }).items).toHaveLength(
      1,
    );
    // Outside every registered project stays refused.
    const outside = await app.request("/public-file-shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        path: path.join(testDir, "stray.html"),
      }),
    });
    expect(outside.status).toBe(400);
    expect(((await outside.json()) as { error: string }).error).toMatch(
      /outside every registered project/,
    );
  });

  it("authorizes exactly the assets an HTML root's elements load for play", async () => {
    files.set(
      "site/index.html",
      '<link rel="stylesheet" href="site.css"><link rel="preload" as="font" href="paper.woff2"><script src="app.js"></script><script src="/assets/entry.js"></script><img src="logo.png"><a href="src/server.js">source</a>',
    );
    files.set("site/site.css", "body{font-family:Paper}");
    files.set("site/app.js", "console.log(1)");
    files.set("site/assets/entry.js", "console.log(3)");
    files.set("site/other.js", "console.log(2)");
    files.set("site/src/server.js", "export const secret = 1;");
    files.set("site/paper.woff2", "font");
    files.set("docs/notes.css", "p{}");
    const { secret } = await service.createFileShare({
      projectId,
      path: "site/index.html",
      title: "Site",
      buildPublicUrl: (value) => `https://ya.example/share/${value}/file`,
    });
    const app = createPublicSharePublicRoutes({
      publicShareService: service,
      loadSession: vi.fn(async () => null),
      getPublicSharesEnabled: () => true,
      fetchProjectFile,
    });
    const status = async (path: string) =>
      (
        await app.request(
          `/${secret}/files/raw?path=${encodeURIComponent(path)}`,
        )
      ).status;
    expect(await status("site/site.css")).toBe(200);
    expect(await status("site/app.js")).toBe(200);
    // A leading slash names the root's directory, as the play page resolves it.
    expect(await status("site/assets/entry.js")).toBe(200);
    expect(await status("site/other.js")).toBe(404);
    // A linked document, and a file no element loads, stay private.
    expect(await status("site/src/server.js")).toBe(404);
    expect(await status("site/paper.woff2")).toBe(404);
    // A Markdown root does not gain script or stylesheet authority.
    const markdown = await service.createFileShare({
      projectId,
      path: "docs/guide.md",
      title: "Guide",
      buildPublicUrl: (value) => `https://ya.example/share/${value}/file`,
    });
    files.set("docs/guide.md", "# Guide\n\n[css](notes.css)\n");
    expect(
      (await app.request(`/${markdown.secret}/files/raw?path=docs%2Fnotes.css`))
        .status,
    ).toBe(404);
  });

  it("serves the current root and only directly referenced render assets", async () => {
    const { secret } = await service.createFileShare({
      projectId,
      path: "docs/guide.md",
      title: "Guide",
      buildPublicUrl: (value) => `https://ya.example/share/${value}/file`,
    });
    const fetchFile = vi.fn(fetchProjectFile);
    const app = createPublicSharePublicRoutes({
      publicShareService: service,
      loadSession: vi.fn(async () => null),
      getPublicSharesEnabled: () => true,
      fetchProjectFile: fetchFile,
    });

    const rootResponse = await app.request(
      `/${secret}/files?path=docs%2Fguide.md&highlight=true`,
    );
    expect(rootResponse.status).toBe(200);
    expect((await rootResponse.json()).content).toContain("# Guide");

    const linkedAsset = await app.request(
      `/${secret}/files/raw?path=docs%2Fdiagram.svg`,
    );
    expect(linkedAsset.status).toBe(200);
    expect(await linkedAsset.text()).toContain("<circle");

    expect(
      (await app.request(`/${secret}/files/raw?path=docs%2Funlinked.svg`))
        .status,
    ).toBe(404);
    expect(
      (await app.request(`/${secret}/files?path=docs%2Fdetails.md`)).status,
    ).toBe(404);

    files.set("docs/guide.md", "# Guide\n\n![Next](next.svg)\n");
    expect(
      (await app.request(`/${secret}/files/raw?path=docs%2Fdiagram.svg`))
        .status,
    ).toBe(404);
    expect(
      (await app.request(`/${secret}/files/raw?path=docs%2Fnext.svg`)).status,
    ).toBe(200);
  });
});
