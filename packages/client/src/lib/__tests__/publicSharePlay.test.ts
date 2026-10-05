import { describe, expect, it, vi } from "vitest";
import { toUrlProjectId } from "@yep-anywhere/shared";
import {
  buildPlayableHtml,
  buildPublicShareFileUrl,
  buildPublicSharePlayUrl,
  PLAY_FRAME_LINKS_SCRIPT,
  parsePublicSharePlayUrl,
  playLinkSharePath,
  publicSharePlayUrlFromFileShareUrl,
} from "../publicSharePlay";

describe("public share play links", () => {
  it("round-trips the grant with the secret in the fragment", () => {
    const href = buildPublicSharePlayUrl("/remote", {
      relayUsername: "host",
      relayUrl: "wss://relay.example/ws",
      secret: "s3cr3t",
      projectId: "cHJvag",
      path: "_build/paper.html",
    });
    expect(href).toBe(
      "/remote/play.html?h=host&projectId=cHJvag&path=_build%2Fpaper.html&r=wss%3A%2F%2Frelay.example%2Fws#share=s3cr3t",
    );
    expect(parsePublicSharePlayUrl(`https://ya.example${href}`)).toEqual({
      relayUsername: "host",
      relayUrl: "wss://relay.example/ws",
      secret: "s3cr3t",
      projectId: "cHJvag",
      path: "_build/paper.html",
    });
    expect(parsePublicSharePlayUrl("https://ya.example/play.html")).toBeNull();
  });

  it("derives the play link from a file share link and keeps its prefix", () => {
    expect(
      publicSharePlayUrlFromFileShareUrl(
        "https://ya.example/share/abc_123/file?h=host&projectId=cHJvag&path=a%2Fb.html&standalone=1&r=wss%3A%2F%2Frelay.example%2Fws#v=2&target=file",
      ),
    ).toBe(
      "https://ya.example/play.html?h=host&projectId=cHJvag&path=a%2Fb.html&r=wss%3A%2F%2Frelay.example%2Fws#share=abc_123",
    );
    expect(
      publicSharePlayUrlFromFileShareUrl(
        "https://ya.example/remote/share/abc/file?h=host&projectId=p&path=x.html",
      ),
    ).toBe(
      "https://ya.example/remote/play.html?h=host&projectId=p&path=x.html#share=abc",
    );
    expect(
      publicSharePlayUrlFromFileShareUrl("https://ya.example/share/abc"),
    ).toBeNull();
  });

  it("names a followed link as the share's walk does, in or out of the project", () => {
    const projectId = toUrlProjectId("/p/draft");
    const from = "research/sr/report.html";
    expect(playLinkSharePath(projectId, from, "../../topics/x.md#a")).toBe(
      "topics/x.md",
    );
    expect(playLinkSharePath(projectId, from, "figs/a.png?v=2")).toBe(
      "research/sr/figs/a.png",
    );
    expect(playLinkSharePath(projectId, from, "../../../notes/y.md")).toBe(
      "/p/notes/y.md",
    );
    expect(playLinkSharePath(projectId, from, "https://x.test/")).toBeNull();
    expect(
      buildPublicShareFileUrl("/remote", {
        relayUsername: "host",
        secret: "s3cr3t",
        projectId: "cHJvag",
        path: "topics/x.md",
      }),
    ).toBe(
      "/remote/share/s3cr3t/file?h=host&projectId=cHJvag&path=topics%2Fx.md&standalone=1#v=2&target=file",
    );
  });
});

describe("public share play", () => {
  it("requests only the assets the share authorizes, root-absolute ones included", async () => {
    const fetchAsset = vi.fn(async (path: string) => {
      if (path === "_build/assets/entry.js")
        return new Blob(["console.log(1)"], { type: "text/javascript" });
      if (path === "_build/pic.png")
        return new Blob(["png"], { type: "image/png" });
      throw new Error("not served");
    });
    const html = await buildPlayableHtml(
      `<script src="/assets/entry.js?v=2"></script><img src=pic.png><a href="src/server.js">source</a><style>p{background:url(bg.png)}</style>`,
      "_build/paper.html",
      fetchAsset,
    );
    expect(fetchAsset.mock.calls.map(([path]) => path)).toEqual([
      "_build/assets/entry.js",
      "_build/pic.png",
    ]);
    expect(html).toContain('<script src="data:text/javascript;base64,');
    expect(html).toContain('<img src="data:image/png;base64,');
    expect(html).toContain('href="src/server.js"');
  });

  it("inlines served assets as data URLs and leaves the rest untouched", async () => {
    const fetchAsset = vi.fn(async (path: string) => {
      if (path === "_build/canvas.css")
        return new Blob(["body{color:red}"], { type: "text/css" });
      if (path === "_build/app.js")
        return new Blob(["console.log(1)"], { type: "text/javascript" });
      throw new Error("not served");
    });
    const html = await buildPlayableHtml(
      `<!doctype html><html><head><base href="/x/"><link rel="stylesheet" href="canvas.css"><script src="app.js"></script><script src="https://cdn.example/lib.js"></script></head><body><img src="missing.png"><p>Hi</p></body></html>`,
      "_build/paper.html",
      fetchAsset,
    );
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toContain("<base");
    expect(html).toContain(`<head><script>${PLAY_FRAME_LINKS_SCRIPT}</script>`);
    expect(html).toContain('href="data:text/css;base64,');
    expect(html).toContain('src="data:text/javascript;base64,');
    expect(html).toContain('src="https://cdn.example/lib.js"');
    expect(html).toContain('src="missing.png"');
    expect(fetchAsset).toHaveBeenCalledTimes(3);
  });
});
