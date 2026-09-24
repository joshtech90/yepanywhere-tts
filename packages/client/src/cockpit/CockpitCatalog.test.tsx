import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { CockpitCatalog } from "./CockpitCatalog";
import type { CockpitCatalogView } from "./core/catalog";

afterEach(cleanup);

function catalogWithSessions(count: number): CockpitCatalogView {
  return {
    sourceKey: "local",
    sessionCount: count,
    projects: [
      {
        key: "local-project-atlas",
        id: "atlas",
        name: "Atlas",
        path: "/work/atlas",
        lastActivityAt: "2026-09-24T12:00:00.000Z",
        sessions: Array.from({ length: count }, (_, index) => ({
          key: `local-session-${index}`,
          id: `session-${index}`,
          projectId: "atlas",
          title: index === 0 ? "Release checklist" : `Fixture session ${index}`,
          provider: "claude",
          lastActivityAt: "2026-09-24T12:00:00.000Z",
          pinned: index === 0,
          status: index === 0 ? "active" : "complete",
        })),
      },
    ],
  };
}

function CatalogHarness({ catalog }: { catalog: CockpitCatalogView }) {
  const [query, setQuery] = useState("");
  return (
    <MemoryRouter>
      <I18nProvider>
        <CockpitCatalog
          basePath=""
          catalog={catalog}
          error={null}
          hasMore={false}
          loading={false}
          onLoadMore={vi.fn(async () => {})}
          onQueryChange={setQuery}
          query={query}
        />
      </I18nProvider>
    </MemoryRouter>
  );
}

describe("Cockpit catalog", () => {
  it("acknowledges every search character within 100 ms during summary updates", () => {
    let catalog = catalogWithSessions(30);
    const { rerender } = render(<CatalogHarness catalog={catalog} />);
    let input = screen.getByRole("searchbox", {
      name: "Loaded sessions",
    }) as HTMLInputElement;
    let value = "";

    for (const character of "Atlas") {
      value += character;
      const startedAt = performance.now();
      fireEvent.change(input, { target: { value } });
      expect(input.value).toBe(value);
      expect(performance.now() - startedAt).toBeLessThan(100);

      catalog = catalogWithSessions(catalog.sessionCount + 1);
      rerender(<CatalogHarness catalog={catalog} />);
      input = screen.getByRole("searchbox", {
        name: "Loaded sessions",
      }) as HTMLInputElement;
      expect(input.value).toBe(value);
    }

    expect(screen.getByText("Release checklist")).toBeTruthy();
  });
});
