import { describe, expect, it } from "vitest";
import {
  CLIENT_SETTINGS_DOCUMENT_KIND,
  ClientSettingsDocumentError,
  diffClientSettings,
  formatClientSettingsDocument,
  parseClientSettingsDocument,
} from "../clientSettingsClipboard";
import { BROWSER_LOCAL_KEYS, UI_KEYS } from "../storageKeys";

function problemOf(text: string): string | null {
  try {
    parseClientSettingsDocument(text);
    return null;
  } catch (error) {
    if (error instanceof ClientSettingsDocumentError) return error.problem;
    throw error;
  }
}

describe("client settings clipboard document", () => {
  it("round-trips the portable settings with source and time", () => {
    const text = formatClientSettingsDocument(
      { [UI_KEYS.theme]: "verydark", [UI_KEYS.fontSize]: "large" },
      "linux:3400",
      new Date("2026-10-07T12:00:00.000Z"),
    );

    const { document, ignoredKeys } = parseClientSettingsDocument(
      `\n  ${text}\n`,
    );

    expect(document).toEqual({
      kind: CLIENT_SETTINGS_DOCUMENT_KIND,
      version: 1,
      sourceHost: "linux:3400",
      copiedAt: "2026-10-07T12:00:00.000Z",
      settings: { [UI_KEYS.theme]: "verydark", [UI_KEYS.fontSize]: "large" },
    });
    expect(ignoredKeys).toEqual([]);
  });

  it("drops non-portable keys, including credentials, and reports them", () => {
    const text = JSON.stringify({
      kind: CLIENT_SETTINGS_DOCUMENT_KIND,
      version: 1,
      settings: {
        [UI_KEYS.theme]: "light",
        [BROWSER_LOCAL_KEYS.xaiSttApiKey]: "secret",
        "yep-anywhere-future-setting": "on",
      },
    });

    const { document, ignoredKeys } = parseClientSettingsDocument(text);

    expect(document.settings).toEqual({ [UI_KEYS.theme]: "light" });
    expect(ignoredKeys).toEqual([
      BROWSER_LOCAL_KEYS.xaiSttApiKey,
      "yep-anywhere-future-setting",
    ]);
  });

  it("rejects text that is not a supported settings document", () => {
    expect(problemOf("hello")).toBe("not-json");
    expect(problemOf('{"kind":"other","version":1,"settings":{}}')).toBe(
      "wrong-kind",
    );
    expect(problemOf("[]")).toBe("wrong-kind");
    expect(
      problemOf(
        `{"kind":"${CLIENT_SETTINGS_DOCUMENT_KIND}","version":2,"settings":{}}`,
      ),
    ).toBe("unsupported-version");
    expect(
      problemOf(
        `{"kind":"${CLIENT_SETTINGS_DOCUMENT_KIND}","version":1,"settings":{"a":1}}`,
      ),
    ).toBe("malformed");
  });

  it("lists every portable key whose value would change, including resets", () => {
    const changes = diffClientSettings(
      { [UI_KEYS.theme]: "light", [UI_KEYS.fontSize]: "large" },
      { [UI_KEYS.theme]: "verydark", [UI_KEYS.tabSize]: "4" },
    );

    expect(changes).toEqual(
      expect.arrayContaining([
        { key: UI_KEYS.theme, from: "light", to: "verydark" },
        { key: UI_KEYS.fontSize, from: "large", to: null },
        { key: UI_KEYS.tabSize, from: null, to: "4" },
      ]),
    );
    expect(changes).toHaveLength(3);
  });
});
