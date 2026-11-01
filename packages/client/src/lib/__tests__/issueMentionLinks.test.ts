import { describe, expect, it } from "vitest";
import {
  annotateIssueMentionsHtml,
  createIssueMentionLinks,
} from "../issueMentionLinks";

const jira = {
  key: "AIP-2823",
  provider: "jira" as const,
  url: "https://jira.example.test/browse/AIP-2823",
};

describe("issue mention links", () => {
  it("preserves existing anchors, code, attributes and surrounding markup", () => {
    const html =
      '<p title="AIP-2823">Check <strong>AIP-2823</strong>, not AIP-28230 or path/AIP-2823. <a href="https://other.test">AIP-2823</a> <code>AIP-2823</code></p><pre>AIP-2823</pre>';
    const output = annotateIssueMentionsHtml(
      html,
      createIssueMentionLinks([jira]),
    );
    const template = document.createElement("template");
    template.innerHTML = output;
    expect(template.content.querySelectorAll("a")).toHaveLength(2);
    expect(
      template.content.querySelector("strong > a")?.getAttribute("href"),
    ).toBe(jira.url);
    expect(template.content.querySelector("code")?.innerHTML).toBe("AIP-2823");
    expect(template.content.querySelector("pre")?.innerHTML).toBe("AIP-2823");
    expect(template.content.textContent).toContain(
      "not AIP-28230 or path/AIP-2823",
    );
    expect(
      annotateIssueMentionsHtml(output, createIssueMentionLinks([jira])),
    ).toBe(output);
  });

  it("never guesses a destination for ambiguous or unresolved mentions", () => {
    const links = createIssueMentionLinks([
      jira,
      { ...jira, url: "https://another.test/browse/AIP-2823" },
      { key: "UNKNOWN-1", provider: "jira", url: null },
      {
        key: "one/repo#42",
        provider: "github",
        url: "https://github.com/one/repo/issues/42",
      },
      {
        key: "two/repo#42",
        provider: "github",
        url: "https://github.com/two/repo/pull/42",
      },
    ]);
    const html = "AIP-2823 UNKNOWN-1 #42 repo#42 one/repo#42 two/repo#42";
    const output = annotateIssueMentionsHtml(html, links);
    const template = document.createElement("template");
    template.innerHTML = output;
    expect(
      [...template.content.querySelectorAll("a")].map((a) => a.textContent),
    ).toEqual(["one/repo#42", "two/repo#42"]);
  });
});
