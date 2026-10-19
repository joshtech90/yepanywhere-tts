// @vitest-environment jsdom

import { compileGlossaryArtifact } from "@yep-anywhere/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SessionMetadataProvider } from "../../../contexts/SessionMetadataContext";
import { I18nProvider } from "../../../i18n";
import { UserPromptLinkedTextContent } from "../UserPromptLinkedText";

function artifact() {
  const result = compileGlossaryArtifact(
    [
      {
        termMarkdown: "**user turn**",
        definitionMarkdown: "A human-authored request.",
        glossaryDirectory: "",
        glossaryOrder: 0,
        rowOrder: 0,
      },
      {
        termMarkdown: "**performance-regression-suite**",
        definitionMarkdown: "The performance regression suite.",
        glossaryDirectory: "",
        glossaryOrder: 0,
        rowOrder: 1,
      },
    ],
    "source-v1",
  );
  if (!result.ok) throw new Error(result.diagnostic.message);
  return result.artifact;
}

describe("UserPromptLinkedText", () => {
  afterEach(cleanup);

  it("keeps file and URL anchors whole while annotating glossary prose", () => {
    const path = "topics/performance-regression-suite.md";
    const { container } = render(
      <SessionMetadataProvider
        projectId="project-1"
        projectPath="/repo"
        sessionId="session-1"
      >
        <I18nProvider>
          <UserPromptLinkedTextContent
            artifact={artifact()}
            projectPathLinks={[{ filePath: path, text: path }]}
            text={`Read this user turn in ${path} and https://example.com/docs.`}
          />
        </I18nProvider>
      </SessionMetadataProvider>,
    );

    const fileLink = screen.getByRole("link", { name: path });
    expect(fileLink.getAttribute("href")).toContain(
      "path=topics%2Fperformance-regression-suite.md",
    );
    expect(fileLink.querySelector("[data-glossary-term]")).toBeNull();
    expect(
      screen.getByRole("link", { name: "https://example.com/docs" }),
    ).toBeDefined();

    const term = container.querySelector<HTMLElement>("[data-glossary-term]");
    expect(term?.textContent).toBe("user turn");
    expect(term?.title).toBe("user turn: A human-authored request.");
  });

  it("opens the path at the top and a cited line at that line", () => {
    render(
      <SessionMetadataProvider
        projectId="project-1"
        projectPath="/repo"
        sessionId="session-1"
      >
        <I18nProvider>
          <UserPromptLinkedTextContent
            artifact={artifact()}
            projectPathLinks={[
              { filePath: "src/a.ts", text: "src/a.ts" },
              { filePath: "/repo/b.ts", text: "/repo/b.ts:7:2" },
            ]}
            text="Fix src/a.ts:42 and /repo/b.ts:7:2 today"
          />
        </I18nProvider>
      </SessionMetadataProvider>,
    );

    const line = (name: string) =>
      new URL(
        screen.getByRole("link", { name }).getAttribute("href") ?? "",
        "http://localhost",
      ).searchParams.get("line");
    expect(line("src/a.ts")).toBeNull();
    expect(line(":42")).toBe("42");
    expect(line("/repo/b.ts")).toBeNull();
    expect(line(":7:2")).toBe("7");
  });

  it("leaves an unconfirmed path as ordinary text", () => {
    render(
      <I18nProvider>
        <UserPromptLinkedTextContent
          artifact={artifact()}
          text="Read topics/commits.md"
        />
      </I18nProvider>,
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/topics\/commits\.md/)).toBeDefined();
  });
});
