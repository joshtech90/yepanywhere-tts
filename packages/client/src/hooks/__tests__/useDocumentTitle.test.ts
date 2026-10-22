// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { invalidateLocalStorageValues } from "../../lib/localStorageValue";
import { UI_KEYS } from "../../lib/storageKeys";
import { formatDocumentTitle, useDocumentTitle } from "../useDocumentTitle";
import { COMPOSER_BEACON_ATTRIBUTE } from "../../lib/composerBeacon";

describe("formatDocumentTitle", () => {
  afterEach(() => {
    cleanup();
    document.querySelector("title")?.removeAttribute(COMPOSER_BEACON_ATTRIBUTE);
    localStorage.clear();
    invalidateLocalStorageValues();
  });

  it.each([false, true])(
    "keeps the complete beacon immediately after formatting with project codes %s",
    (codes) => {
      localStorage.setItem(UI_KEYS.projectCodeNamesEnabled, String(codes));
      invalidateLocalStorageValues();
      document.title = "Session";
      const suffix =
        "✓ [YA1 f=1792526000000 r=1792526000100 a=1792526000100 s=delivered] w=1";
      document
        .querySelector("title")
        ?.setAttribute(COMPOSER_BEACON_ATTRIBUTE, suffix);
      const hook = renderHook(
        ({ name }) => useDocumentTitle("long-project-name", "yep", name),
        {
          initialProps: {
            name: "A long session title that exceeds the human title budget",
          },
        },
      );
      expect(document.title).toBe(
        `${formatDocumentTitle("long-project-name", codes ? "yep" : undefined, "A long session title that exceeds the human title budget")} ${suffix}`,
      );
      hook.rerender({
        name: "A different long session title that exceeds the budget",
      });
      expect(document.title.endsWith(` ${suffix}`)).toBe(true);
      expect(document.title.match(/\[YA1/g)).toHaveLength(1);
    },
  );

  it("uses the compact project code name without truncating the session title", () => {
    expect(
      formatDocumentTitle(
        "yepanywhere",
        "yep",
        "Improve tab title animation space efficiency",
      ),
    ).toBe("yep:Improve tab title animation space efficiency");
  });

  it("keeps the released full-name title fallback for older servers", () => {
    expect(
      formatDocumentTitle(
        "project-with-a-long-name",
        undefined,
        "session title that is also quite long",
      ),
    ).toBe("project-w… - session title that …");
  });

  it("uses the full-name title fallback by default even when a code exists", () => {
    renderHook(() =>
      useDocumentTitle(
        "yepanywhere",
        "yep",
        "Improve tab title animation space efficiency",
      ),
    );

    expect(document.title).toBe("yepanywhe… - Improve tab title a…");
    expect(
      document.querySelector("title")?.hasAttribute("data-project-code-name"),
    ).toBe(false);
  });

  it("uses the project code title only after browser opt-in", () => {
    localStorage.setItem(UI_KEYS.projectCodeNamesEnabled, "true");
    invalidateLocalStorageValues(UI_KEYS.projectCodeNamesEnabled);

    renderHook(() =>
      useDocumentTitle(
        "yepanywhere",
        "yep",
        "Improve tab title animation space efficiency",
      ),
    );

    expect(document.title).toBe(
      "yep:Improve tab title animation space efficiency",
    );
    expect(
      document.querySelector("title")?.hasAttribute("data-project-code-name"),
    ).toBe(true);
  });
});
