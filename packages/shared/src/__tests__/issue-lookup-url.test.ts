import { describe, expect, it } from "vitest";
import { issueLookupUrl } from "../issues.js";

describe("issueLookupUrl", () => {
  it("names the item a browser tab shows", () => {
    expect(
      issueLookupUrl("https://github.com/TomFitAG/tomfit-api/pull/482/files")
        ?.identity,
    ).toBe("github:github.com:tomfitag/tomfit-api:482");
    // Jira Cloud boards and Server/Data Center paths under a context path.
    expect(
      issueLookupUrl(
        "https://tomfit.atlassian.net/jira/software/projects/TF/boards/1?selectedIssue=TF-7",
      )?.url,
    ).toBe("https://tomfit.atlassian.net/browse/TF-7");
    expect(
      issueLookupUrl(
        "https://jira.example.com/tracker/secure/RapidBoard.jspa?rapidView=3&selectedIssue=ops-12",
      )?.identity,
    ).toBe("jira:jira.example.com/tracker:OPS-12");
  });

  it("rejects pages that name no item", () => {
    expect(issueLookupUrl("https://github.com/TomFitAG/tomfit-api")).toBeNull();
    expect(
      issueLookupUrl("https://x.atlassian.net/jira/boards/1?selectedIssue=7"),
    ).toBeNull();
    expect(issueLookupUrl("not a url")).toBeNull();
  });
});
