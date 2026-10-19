// @vitest-environment jsdom

import {
  type ProjectPathLinkTarget,
  toUrlProjectId,
} from "@yep-anywhere/shared";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "../types";
import type {
  RenderItem,
  TextItem,
  ToolCallItem,
} from "@yep-anywhere/shared/transcript/items";
import { annotateProjectPathLinksHtml } from "./projectPathLinks";
import {
  applyRecentProjectPathLinks,
  recentProjectFileMentions,
  recentProjectFileMentionSources,
} from "./recentProjectPathLinks";
import { canReuseRenderItem } from "./stableRenderItems";
import { compileWebTranscriptProjection } from "./webTranscriptProjection";

function commandItem(
  id: string,
  command: string,
  links?: ProjectPathLinkTarget[],
): ToolCallItem {
  return {
    type: "tool_call",
    id,
    toolName: "exec_command",
    toolInput: { cmd: command, _projectPathLinks: links },
    status: "complete",
    sourceMessages: [],
  };
}

function textItem(id: string, text: string, augmentHtml?: string): TextItem {
  return {
    type: "text",
    sourceBlockIndex: 0,
    id,
    text,
    augmentHtml,
    sourceMessages: [],
  };
}

function projectedTextLink(
  items: RenderItem[],
  id: string,
): ProjectPathLinkTarget {
  const item = items.find((candidate) => candidate.id === id);
  if (item?.type !== "text") throw new Error(`missing text item ${id}`);
  const link = item.projectPathLinks?.[0];
  if (!link) throw new Error(`missing project path link for ${id}`);
  return link;
}

describe("applyRecentProjectPathLinks", () => {
  it("orders completion paths by mentions, including causal basename aliases, without losing collisions", () => {
    const items = [
      commandItem("a", "cat a/settings.json", [
        { text: "a/settings.json", filePath: "a/settings.json" },
      ]),
      commandItem("b", "cat b/settings.json", [
        { text: "b/settings.json", filePath: "b/settings.json" },
      ]),
      commandItem("c", "cat src/recent.ts", [
        { text: "src/recent.ts", filePath: "src/recent.ts" },
      ]),
      commandItem("d", "cat settings.json"),
    ];
    expect(recentProjectFileMentions(items)).toEqual([
      "b/settings.json",
      "src/recent.ts",
      "a/settings.json",
    ]);
    // Each path remembers the item that mentioned it last, for go-to-turn.
    expect(recentProjectFileMentionSources(items)).toEqual([
      { path: "b/settings.json", itemId: "d" },
      { path: "src/recent.ts", itemId: "c" },
      { path: "a/settings.json", itemId: "a" },
    ]);
  });
  it("keeps basename relinking off unless explicitly enabled", () => {
    const messages: Message[] = [
      {
        id: "full-path",
        type: "user",
        content: "Open src/settings.json",
        _projectPathLinks: [
          { text: "src/settings.json", filePath: "src/settings.json" },
        ],
      },
      {
        id: "basename",
        type: "user",
        content: "Then check settings.json",
      },
    ];

    const defaultProjection = compileWebTranscriptProjection(messages);
    const enabledProjection = compileWebTranscriptProjection(
      messages,
      undefined,
      true,
    );
    const defaultBasenameItem = defaultProjection.find(
      (item) => item.id === "basename",
    );

    expect(defaultBasenameItem?.type).toBe("user_prompt");
    if (defaultBasenameItem?.type !== "user_prompt") {
      throw new Error("Expected basename message to compile as a user prompt");
    }
    expect(defaultBasenameItem.projectPathLinks).toBeUndefined();
    expect(
      enabledProjection.find((item) => item.id === "basename"),
    ).toMatchObject({
      projectPathLinks: [
        { text: "settings.json", filePath: "src/settings.json" },
      ],
    });
  });

  it("uses only the most recent full path from the preceding replay prefix", () => {
    const first = commandItem("first", "open src/one/settings.json", [
      { text: "src/one/settings.json", filePath: "src/one/settings.json" },
    ]);
    const beforeReplacement = textItem("before", "Check settings.json.");
    const replacement = commandItem(
      "replacement",
      "open src/two/settings.json",
      [{ text: "src/two/settings.json", filePath: "src/two/settings.json" }],
    );
    const afterReplacement = textItem("after", "Check settings.json.");

    const projected = applyRecentProjectPathLinks([
      first,
      beforeReplacement,
      replacement,
      afterReplacement,
    ]);

    expect(projectedTextLink(projected, "before")).toEqual({
      text: "settings.json",
      filePath: "src/one/settings.json",
    });
    expect(projectedTextLink(projected, "after")).toEqual({
      text: "settings.json",
      filePath: "src/two/settings.json",
    });
  });

  it("does not let later transcript links retarget an earlier basename", () => {
    const prefix = [
      commandItem("first", "open src/one/settings.json", [
        { text: "src/one/settings.json", filePath: "src/one/settings.json" },
      ]),
      textItem("stable", "Check settings.json."),
    ];
    const before = applyRecentProjectPathLinks(prefix);
    const after = applyRecentProjectPathLinks([
      ...prefix,
      commandItem("later", "open src/two/settings.json", [
        { text: "src/two/settings.json", filePath: "src/two/settings.json" },
      ]),
    ]);

    expect(projectedTextLink(after, "stable")).toEqual(
      projectedTextLink(before, "stable"),
    );
  });

  it("does not refresh the table from a basename-expanded link", () => {
    const projected = applyRecentProjectPathLinks([
      commandItem("full", "open src/settings.json", [
        { text: "src/settings.json", filePath: "src/settings.json" },
      ]),
      commandItem("basename", "open settings.json", [
        { text: "settings.json", filePath: "settings.json" },
      ]),
      textItem("after", "Check settings.json."),
    ]);

    expect(projectedTextLink(projected, "after").filePath).toBe(
      "src/settings.json",
    );
  });

  it("notices full project-file anchors in assistant HTML", () => {
    const projected = applyRecentProjectPathLinks([
      textItem(
        "full",
        "See packages/client/src/main.tsx.",
        '<p>See <a data-ya-resource="project-file" data-ya-path="packages/client/src/main.tsx">packages/client/src/main.tsx</a>.</p>',
      ),
      textItem("basename", "Then main.tsx."),
    ]);

    expect(projectedTextLink(projected, "basename")).toEqual({
      text: "main.tsx",
      filePath: "packages/client/src/main.tsx",
    });
  });

  it("uses Windows-aware basenames without matching longer suffixes", () => {
    const projected = applyRecentProjectPathLinks([
      commandItem("full", "open C:\\repo\\src\\settings.json", [
        {
          text: "C:\\repo\\src\\settings.json",
          filePath: "C:\\repo\\src\\settings.json",
        },
      ]),
      textItem("basename", "Check settings.json and src/settings.json."),
    ]);

    const item = projected.find((candidate) => candidate.id === "basename");
    expect(item?.type === "text" ? item.projectPathLinks : undefined).toEqual([
      {
        text: "settings.json",
        filePath: "C:\\repo\\src\\settings.json",
      },
    ]);
  });

  it("prevents stabilization from hiding a newly available prefix alias", () => {
    const previous = textItem("basename", "Check settings.json.");
    const next = {
      ...previous,
      projectPathLinks: [
        { text: "settings.json", filePath: "src/settings.json" },
      ],
    };

    expect(canReuseRenderItem(previous, next)).toBe(false);
  });
});

describe("annotateProjectPathLinksHtml", () => {
  it("uses occurrence-specific directories over root and recent links, with reversible preferences", () => {
    const html =
      '<p><a data-ya-resource="project-file" data-ya-path="README.md" href="/root"><code><span data-ya-directory-file="a/README.md">README.md</span></code></a> and <span data-ya-directory-file="b/README.md"><a data-ya-resource="local-file" href="/root">README.md</a></span> plus <span data-ya-directory-file="b/score.sh">score.sh</span>.</p>';
    const aliases = [{ text: "README.md", filePath: "recent/README.md" }];
    const template = document.createElement("template");
    const setAttribute = vi.spyOn(HTMLAnchorElement.prototype, "setAttribute");
    template.innerHTML = annotateProjectPathLinksHtml(
      html,
      aliases,
      "project",
    ).html;
    const writtenHrefs = setAttribute.mock.calls
      .filter(([name]) => name === "href")
      .map(([, value]) => value);
    setAttribute.mockRestore();
    // Directory matches must bypass the recent-name fallback entirely, rather
    // than building an alias and overwriting it in another pass.
    expect(writtenHrefs.some((href) => href.includes("recent%2F"))).toBe(false);
    expect(
      [...template.content.querySelectorAll("a")].map((anchor) => [
        anchor.textContent,
        anchor.dataset.yaPath,
      ]),
    ).toEqual([
      ["a/README.md", "a/README.md"],
      ["b/README.md", "b/README.md"],
      ["b/score.sh", "b/score.sh"],
    ]);
    expect(template.content.querySelector("a a")).toBeNull();
    const disabled = annotateProjectPathLinksHtml(
      html,
      undefined,
      "project",
      null,
      { projectPaths: true, mentionedDirectories: false },
    );
    expect(disabled.html).toBe(html);
    template.innerHTML = annotateProjectPathLinksHtml(
      html,
      aliases,
      "project",
      null,
      { projectPaths: false, mentionedDirectories: true },
    ).html;
    expect(template.content.querySelector("a")).toBeNull();
    expect(template.content.textContent).toBe(
      "README.md and README.md plus score.sh.",
    );
  });

  it("splits a visible cited line off server-rendered file links", () => {
    const html = [
      '<p><a class="fixed-font-file-link" data-ya-resource="project-file" data-ya-path="src/a.ts" data-ya-line="42" href="/projects/p/file?path=src%2Fa.ts&amp;line=42"><code>src/a.ts:42</code></a>',
      ' <a data-ya-resource="project-file" data-ya-path="b.md" href="/projects/p/file?path=b.md">b.md</a>:7-9,',
      ' <a data-ya-resource="project-file" data-ya-path="c.md" data-ya-line="3" href="/projects/p/file?path=c.md&amp;line=3">see c</a>',
      ' <a data-ya-resource="local-file" data-ya-path="/x/notes.md:12" href="/api/local-file?path=%2Fx%2Fnotes.md%3A12">/x/notes.md:12</a></p>',
    ].join("");
    const template = document.createElement("template");
    template.innerHTML = annotateProjectPathLinksHtml(
      html,
      undefined,
      "p",
    ).html;
    const links = [...template.content.querySelectorAll("a")].map((link) => [
      link.innerHTML,
      link.dataset.yaLine,
      link.dataset.yaLineEnd,
      new URL(
        link.getAttribute("href") ?? "",
        "http://localhost",
      ).searchParams.get("line"),
    ]);

    expect(links).toEqual([
      ["src/a.ts", undefined, undefined, null],
      [":42", "42", undefined, "42"],
      ["b.md", undefined, undefined, null],
      [":7-9", "7", "9", "7"],
      ["see c", "3", undefined, "3"],
      ["/x/notes.md:12", undefined, undefined, null],
    ]);
    // Inline code stays one pill holding both links.
    expect(template.content.querySelectorAll("code")).toHaveLength(1);
    expect(template.content.querySelector("code a + a")?.textContent).toBe(
      ":42",
    );
    expect(template.content.textContent).toBe(
      "src/a.ts:42 b.md:7-9, see c /x/notes.md:12",
    );
  });

  it("links basename text through the current session project", () => {
    const result = annotateProjectPathLinksHtml(
      "<p>Open <code>settings.json</code>.</p>",
      [{ text: "settings.json", filePath: "src/settings.json" }],
      "project-1",
    );
    const template = document.createElement("template");
    template.innerHTML = result.html;
    const anchor = template.content.querySelector("a");

    expect(result.changed).toBe(true);
    expect(anchor?.textContent).toBe("settings.json");
    expect(anchor?.getAttribute("data-ya-path")).toBe("src/settings.json");
    expect(anchor?.getAttribute("data-ya-project-id")).toBe("project-1");
    expect(anchor?.getAttribute("href")).toBe(
      "/projects/project-1/file?path=src%2Fsettings.json",
    );
  });

  it("links through the share's own file route for a public share viewer", () => {
    const projectId = toUrlProjectId("/home/me/project");
    const result = annotateProjectPathLinksHtml(
      "<p>Open <code>settings.json</code>.</p>",
      [{ text: "settings.json", filePath: "src/settings.json" }],
      projectId,
      {
        projectId,
        relayUrl: "wss://relay.example/ws",
        relayUsername: "me",
        secret: "share-secret",
      },
    );
    const template = document.createElement("template");
    template.innerHTML = result.html;
    const anchor = template.content.querySelector("a");

    expect(result.changed).toBe(true);
    expect(anchor?.getAttribute("href")).toContain("/share/share-secret/file");
    expect(anchor?.getAttribute("href")).toContain("path=src%2Fsettings.json");
    // The share page unwraps this marker back into plain code.
    expect(anchor?.getAttribute("data-ya-private-project-file-link")).toBe(
      null,
    );
  });

  it("leaves a path outside the share's project unlinked", () => {
    const result = annotateProjectPathLinksHtml(
      "<p>Open <code>secret.json</code>.</p>",
      [{ text: "secret.json", filePath: "/elsewhere/secret.json" }],
      toUrlProjectId("/home/me/project"),
      {
        projectId: toUrlProjectId("/home/me/project"),
        relayUrl: "wss://relay.example/ws",
        relayUsername: "me",
        secret: "share-secret",
      },
    );

    expect(result.changed).toBe(false);
    expect(result.html).not.toContain("<a");
  });

  it("retargets an exact bare-path anchor to the prefix-causal alias", () => {
    const result = annotateProjectPathLinksHtml(
      '<p><a data-ya-resource="project-file" data-ya-project-id="project-1" data-ya-path="settings.json" href="/old">settings.json</a></p>',
      [{ text: "settings.json", filePath: "src/settings.json" }],
      "project-1",
    );
    const template = document.createElement("template");
    template.innerHTML = result.html;

    expect(
      template.content.querySelector("a")?.getAttribute("data-ya-path"),
    ).toBe("src/settings.json");
  });
});
