import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CockpitTranscriptEntry } from "./core/sessionDetail";
import { CockpitTranscriptWindow } from "./CockpitTranscriptWindow";

afterEach(cleanup);

function entries(count: number): CockpitTranscriptEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "user",
    key: `entry-${index}`,
    text: `Invented message ${index}`,
  }));
}

function transcript(items: CockpitTranscriptEntry[]) {
  return (
    <CockpitTranscriptWindow
      beforeRows={null}
      entries={items}
      following
      pinnedEntryKey={null}
      renderEntry={(entry) => (
        <article data-testid="entry">
          {entry.key}
        </article>
      )}
    />
  );
}

function pinnedTranscript(
  items: CockpitTranscriptEntry[],
  pinnedEntryKey: string,
) {
  return (
    <CockpitTranscriptWindow
      beforeRows={null}
      entries={items}
      following
      pinnedEntryKey={pinnedEntryKey}
      renderEntry={(entry) => (
        <article data-testid="entry">
          {entry.key}
        </article>
      )}
    />
  );
}

describe("Cockpit transcript render window", () => {
  it("keeps the direct DOM path for an ordinary transcript", () => {
    const view = render(transcript(entries(20)));

    expect(view.getAllByTestId("entry")).toHaveLength(20);
    expect(
      view.container.querySelector("[data-cockpit-render-boundary]"),
    ).toBeNull();
    expect(
      view.container.querySelector("[data-cockpit-render-spacer]"),
    ).toBeNull();
  });

  it("mounts only the measured tail window for a very long transcript", () => {
    const view = render(transcript(entries(240)));
    const mountedRows = view.container.querySelectorAll("[data-render-id]");

    expect(mountedRows.length).toBeGreaterThan(0);
    expect(mountedRows.length).toBeLessThanOrEqual(48);
    expect(
      view.container.querySelector('[data-render-id="entry-0"]'),
    ).toBeNull();
    expect(
      view.container.querySelector('[data-render-id="entry-239"]'),
    ).not.toBeNull();
    expect(
      view.container.querySelector('[data-cockpit-render-spacer="before"]'),
    ).not.toBeNull();
  });

  it("keeps a pagination anchor mounted outside the tail window", () => {
    const view = render(pinnedTranscript(entries(240), "entry-0"));

    expect(
      view.container.querySelector('[data-render-id="entry-0"]'),
    ).not.toBeNull();
    expect(
      view.container.querySelectorAll("[data-render-id]").length,
    ).toBeLessThanOrEqual(48);
  });

  it("retains an open disclosure while another window is pinned", () => {
    const items = entries(240);
    const renderWindow = (pinnedEntryKey: string | null) => (
      <CockpitTranscriptWindow
        beforeRows={null}
        entries={items}
        following
        pinnedEntryKey={pinnedEntryKey}
        renderEntry={(entry) => (
          <details data-cockpit-entry-key={entry.key}>
            <summary>{entry.key}</summary>
          </details>
        )}
      />
    );
    const view = render(renderWindow(null));
    const openEntry = view.container.querySelector<HTMLDetailsElement>(
      '[data-cockpit-entry-key="entry-239"] details',
    );
    if (!openEntry) throw new Error("tail disclosure missing");
    openEntry.open = true;
    fireEvent(openEntry, new Event("toggle"));

    view.rerender(renderWindow("entry-0"));

    expect(
      view.container.querySelector('[data-render-id="entry-0"]'),
    ).not.toBeNull();
    expect(
      view.container.querySelector('[data-render-id="entry-239"]'),
    ).not.toBeNull();
    expect(
      view.container.querySelectorAll("[data-render-id]").length,
    ).toBeLessThanOrEqual(49);
  });
});
