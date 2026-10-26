import { describe, expect, it } from "vitest";
import { appTabUrl } from "../artifactPreview";

describe("appTabUrl", () => {
  const view = "https://draft.example.org/?ya_access=token";

  it("opens the app's own page with the view's access restored", () => {
    expect(appTabUrl("https://draft.example.org/papers/a.pdf#p2", view)).toBe(
      "https://draft.example.org/papers/a.pdf?ya_access=token",
    );
  });

  it("refuses other origins, credentials and query strings", () => {
    expect(appTabUrl("https://evil.example/a.pdf", view)).toBeUndefined();
    expect(
      appTabUrl("https://u:p@draft.example.org/a.pdf", view),
    ).toBeUndefined();
    expect(
      appTabUrl("https://draft.example.org/a.pdf?ya_access=other", view),
    ).toBeUndefined();
  });
});
