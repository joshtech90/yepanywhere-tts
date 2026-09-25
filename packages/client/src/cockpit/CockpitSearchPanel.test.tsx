import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitSearchPanel } from "./CockpitSearchPanel";
import type { CockpitSearchData } from "./useCockpitSearch";

const searchMock = vi.hoisted(() => ({
  data: {
    results: [],
    support: "checking" as const,
    loadedSessionCount: 2,
    catalogLoading: false,
    catalogHasMore: false,
    contentRunning: false,
    partialSessions: [],
    unsupportedProviderSessionCount: 0,
    error: null,
  } as CockpitSearchData,
  calls: [] as Array<{ query: string; fields: string[] }>,
}));

vi.mock("./useCockpitSearch", () => ({
  useCockpitSearch: (query: string, fields: string[]) => {
    searchMock.calls.push({ query, fields: [...fields] });
    return searchMock.data;
  },
}));

afterEach(() => {
  cleanup();
  searchMock.calls = [];
  searchMock.data = {
    results: [],
    support: "checking",
    loadedSessionCount: 2,
    catalogLoading: false,
    catalogHasMore: false,
    contentRunning: false,
    partialSessions: [],
    unsupportedProviderSessionCount: 0,
    error: null,
  };
});
beforeEach(() => localStorage.setItem(UI_KEYS.locale, "en"));

function result(id: string, title: string) {
  return {
    session: {
      id,
      title,
      fullTitle: title,
      createdAt: "2026-09-24T12:00:00.000Z",
      updatedAt: "2026-09-24T12:00:00.000Z",
      messageCount: 1,
      provider: "claude" as const,
      projectId: "atlas",
      projectName: "Atlas",
      ownership: { owner: "none" as const },
    },
    titleMatched: true,
    matches: [
      {
        id: "title",
        role: "title" as const,
        preview: title,
        fullText: title,
      },
    ],
  };
}

function renderSearch() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <CockpitSearchPanel
          basePath=""
          onClose={vi.fn()}
          onNavigate={vi.fn()}
        />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("Cockpit global search", () => {
  it("keeps sequential input while search data rerenders", () => {
    const view = renderSearch();
    const input = screen.getByRole("searchbox", {
      name: "Search all sessions",
    }) as HTMLInputElement;
    let value = "";

    for (const character of "Atlas") {
      value += character;
      const startedAt = performance.now();
      fireEvent.change(input, { target: { value } });
      expect(input.value).toBe(value);
      expect(performance.now() - startedAt).toBeLessThan(100);
      searchMock.data = {
        ...searchMock.data,
        loadedSessionCount: searchMock.data.loadedSessionCount + 1,
      };
      view.rerender(
        <MemoryRouter>
          <I18nProvider>
            <CockpitSearchPanel
              basePath=""
              onClose={vi.fn()}
              onNavigate={vi.fn()}
            />
          </I18nProvider>
        </MemoryRouter>,
      );
      expect(input.value).toBe(value);
    }

    expect(searchMock.calls.at(-1)?.query).toBe("Atlas");
  });

  it("retains a requested content field while capability support is pending", () => {
    renderSearch();
    const userField = screen.getByRole("checkbox", {
      name: "Your messages",
    }) as HTMLInputElement;

    fireEvent.click(userField);

    expect(userField.checked).toBe(true);
    expect(searchMock.calls.at(-1)?.fields).toContain("user");
  });

  it("keeps the selected group when another result arrives", () => {
    const first = result("first", "Research notes");
    const arriving = result("arriving", "Research archive");
    searchMock.data = {
      ...searchMock.data,
      support: "supported",
      results: [first],
    };
    const view = renderSearch();

    expect(
      screen
        .getByRole("link", { name: /Research notes/ })
        .getAttribute("aria-current"),
    ).toBe("true");

    searchMock.data = {
      ...searchMock.data,
      results: [arriving, first],
    };
    view.rerender(
      <MemoryRouter>
        <I18nProvider>
          <CockpitSearchPanel
            basePath=""
            onClose={vi.fn()}
            onNavigate={vi.fn()}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(
      screen
        .getByRole("link", { name: /Research notes/ })
        .getAttribute("aria-current"),
    ).toBe("true");
  });

  it("moves between stable search results with the arrow keys", () => {
    searchMock.data = {
      ...searchMock.data,
      support: "supported",
      results: [
        result("first", "Research notes"),
        result("second", "Research archive"),
      ],
    };
    renderSearch();
    const input = screen.getByRole("searchbox", {
      name: "Search all sessions",
    });
    const first = screen.getByRole("link", { name: "Research notes" });
    const second = screen.getByRole("link", { name: "Research archive" });
    input.focus();

    const arrowUp = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowUp",
    });
    fireEvent(input, arrowUp);
    expect(arrowUp.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    expect(second.getAttribute("aria-current")).toBe("true");

    fireEvent.keyDown(second, { key: "ArrowUp" });
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(document.activeElement).toBe(input);
  });
});
