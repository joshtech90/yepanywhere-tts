import { toUrlProjectId } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import {
  type PublicShareContextValue,
  rewritePublicShareLocalAppLinks,
} from "../PublicShareContext";

const context: PublicShareContextValue = {
  projectId: toUrlProjectId("/repo"),
  relayUrl: "wss://relay.example/ws",
  relayUsername: "host",
  secret: "s3cr3t",
};
const currentHref = "https://ya.example/share/s3cr3t/file?path=docs%2Fa.md";

function rewrite(html: string, value: PublicShareContextValue): string | null {
  const template = document.createElement("template");
  template.innerHTML = html;
  rewritePublicShareLocalAppLinks(template.content, value, currentHref);
  return template.content.querySelector("a")?.getAttribute("href") ?? null;
}

describe("public share link rewriting", () => {
  const outsideLink =
    '<a href="/api/local-file?path=%2Fnotes%2Fx.md&amp;render=1&amp;line=3">x</a>';

  it("points a live file share's outside link at the same share, by absolute path", () => {
    const href = new URL(
      rewrite(outsideLink, { ...context, standaloneFile: true })!,
      currentHref,
    );
    expect(href.pathname).toBe("/share/s3cr3t/file");
    expect(href.searchParams.get("path")).toBe("/notes/x.md");
    expect(href.searchParams.get("line")).toBe("3");
    expect(href.searchParams.get("standalone")).toBe("1");
  });

  it("leaves a session share's outside link unrewritten", () => {
    expect(rewrite(outsideLink, context)).toBe(
      "/api/local-file?path=%2Fnotes%2Fx.md&render=1&line=3",
    );
  });

  it("rewrites an in-project link to its project-relative path either way", () => {
    const inside =
      '<a href="/api/local-file?path=%2Frepo%2Ftopics%2Fy.md">y</a>';
    for (const value of [context, { ...context, standaloneFile: true }])
      expect(
        new URL(rewrite(inside, value)!, currentHref).searchParams.get("path"),
      ).toBe("topics/y.md");
  });
});
