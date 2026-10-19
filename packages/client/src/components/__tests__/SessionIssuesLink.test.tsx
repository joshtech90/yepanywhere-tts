import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SessionIssuesLink } from "../SessionIssuesLink";

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  enabled: true,
}));
const runtime = { sourceKey: "localhost", transport: { fetch: state.fetch } };
vi.mock("../../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => runtime,
}));
vi.mock("../../hooks/useIssuesEnabled", () => ({
  useIssuesEnabled: () => state.enabled,
}));
vi.mock("../../hooks/useRemoteBasePath", () => ({
  useRemoteBasePath: () => "",
}));

function item(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `i${index}`,
    key: `AUTOTEST-${index}`,
    title: `Title ${index}`,
    url: `https://example.test/browse/AUTOTEST-${index}`,
    provider: "jira",
    kind: "issue",
    sessionCount: 1,
    unresolved: false,
    ...overrides,
  };
}

function result(count: number, more = false, active = false) {
  return {
    items: Array.from({ length: count }, (_, index) => item(index)),
    coverage: { settings: {}, active, error: null, counts: [] },
    nextOffset: more ? count : null,
  };
}

function tree(messageCount: number) {
  return (
    <I18nProvider>
      <MemoryRouter>
        <SessionIssuesLink
          sessionId="s1"
          projectId="p1"
          messageCount={messageCount}
        />
      </MemoryRouter>
    </I18nProvider>
  );
}

function renderLink(messageCount = 3) {
  return render(tree(messageCount));
}

async function openMenu(name: string) {
  const trigger = await screen.findByRole("button", { name });
  fireEvent.click(trigger);
  return trigger;
}

describe("SessionIssuesLink", () => {
  beforeEach(() => {
    state.enabled = true;
    state.fetch.mockReset();
  });
  afterEach(cleanup);

  it("shows only the glyph and the count, and opens a menu instead of navigating", async () => {
    state.fetch.mockResolvedValue(result(2));
    renderLink();
    const trigger = await screen.findByRole("button", {
      name: "2 issues and pull requests associated with this session",
    });
    // The icon plus the count is the whole control: no full-width name.
    expect(trigger.textContent).toBe("2");
    expect(trigger.querySelector("svg")).toBeTruthy();
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(state.fetch).toHaveBeenCalledWith(
      "/issues?sessionId=s1&projectId=p1&limit=100",
    );

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const items = screen.getAllByRole("menuitem");
    expect(items.map((row) => row.textContent)).toEqual([
      "AUTOTEST-0Title 0",
      "AUTOTEST-1Title 1",
      "Show all in this session",
    ]);
    // Opening the menu reuses the page that supplied the count.
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });

  it("links each row at its tracker, leaving new-tab clicks to the browser", async () => {
    state.fetch.mockResolvedValue(result(1));
    renderLink();
    await openMenu("1 issue or pull request associated with this session");
    const row = screen.getAllByRole("menuitem")[0]!;
    expect(row.getAttribute("href")).toBe(
      "https://example.test/browse/AUTOTEST-0",
    );
    expect(row.getAttribute("target")).toBeNull();
  });

  it("stays open for new-tab clicks and closes for a navigating one", async () => {
    state.fetch.mockResolvedValue(result(2));
    renderLink();
    await openMenu("2 issues and pull requests associated with this session");
    // jsdom does not navigate; the menu's own response is what is under test.
    const row = () => screen.getAllByRole("menuitem")[0]!;
    row().addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(row(), { metaKey: true });
    fireEvent.click(row(), { ctrlKey: true });
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(row());
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("describes a row before it is clicked", async () => {
    state.fetch.mockResolvedValue({
      items: [item(7, { sessionCount: 3, unresolved: true, kind: "pr" })],
      coverage: { settings: {}, active: false, error: null, counts: [] },
      nextOffset: null,
    });
    renderLink();
    await openMenu("1 issue or pull request associated with this session");
    expect(
      screen.getAllByRole("menuitem")[0]!.getAttribute("data-tooltip"),
    ).toBe(
      [
        "Title 7",
        "AUTOTEST-7 · jira · Pull request · 3 sessions",
        "Issue link unknown",
        "https://example.test/browse/AUTOTEST-7",
        "Click to open it; middle-click for a new tab",
      ].join("\n"),
    );
  });

  it("sends a reference with no tracker link to this session's list", async () => {
    state.fetch.mockResolvedValue({
      items: [item(3, { url: null, title: null })],
      coverage: { settings: {}, active: false, error: null, counts: [] },
      nextOffset: null,
    });
    renderLink();
    await openMenu("1 issue or pull request associated with this session");
    const row = screen.getAllByRole("menuitem")[0]!;
    expect(row.textContent).toBe("AUTOTEST-3");
    expect(row.getAttribute("href")).toBe("/issues?sessionId=s1&projectId=p1");
  });

  it("caps the rows and says how many more the full list holds", async () => {
    state.fetch.mockResolvedValue(result(100, true));
    renderLink();
    const trigger = await openMenu(
      "100+ issues and pull requests associated with this session",
    );
    expect(trigger.textContent).toBe("100+");
    // Twelve references plus the row that opens the full list.
    expect(screen.getAllByRole("menuitem")).toHaveLength(13);
    expect(screen.getByText("88 more in the full list")).toBeTruthy();
    const browse = screen.getByRole("menuitem", {
      name: "Show all in this session",
    });
    expect(browse.getAttribute("href")).toBe(
      "/issues?sessionId=s1&projectId=p1",
    );
  });

  it("lists pull requests first and keeps them in view past a long ticket list", async () => {
    const at = (minute: number) =>
      `2026-10-13T08:${String(minute).padStart(2, "0")}:00.000Z`;
    state.fetch.mockResolvedValue({
      items: [
        ...Array.from({ length: 18 }, (_, index) =>
          item(index, { lastMentionAt: at(index) }),
        ),
        item(90, { kind: "pr", key: "o/r#90", lastMentionAt: at(5) }),
        item(91, { kind: "pr", key: "o/r#91", lastMentionAt: null }),
        item(92, { kind: "pr", key: "o/r#92", lastMentionAt: at(30) }),
      ],
      coverage: { settings: {}, active: false, error: null, counts: [] },
      nextOffset: null,
    });
    renderLink();
    await openMenu("21 issues and pull requests associated with this session");
    const [prs, issues] = screen.getAllByRole("group");
    expect(prs!.getAttribute("aria-labelledby")).toBe(
      screen.getByText("Pull requests").id,
    );
    const keys = (group: HTMLElement) =>
      Array.from(group.querySelectorAll('[role="menuitem"]')).map(
        (row) => row.querySelector("span")?.textContent,
      );
    expect(keys(prs!)).toEqual(["o/r#92", "o/r#90", "o/r#91"]);
    // The tickets fill what the PRs leave, newest mention first.
    expect(keys(issues!)).toEqual(
      [17, 16, 15, 14, 13, 12, 11, 10, 9].map((n) => `AUTOTEST-${n}`),
    );
    expect(screen.getByText("9 more in the full list")).toBeTruthy();
  });

  it("asks again in mention order when a key-ordered page is incomplete", async () => {
    state.fetch.mockResolvedValue({
      ...result(100, true),
      supportedSorts: ["activity", "mentioned", "number"],
    });
    renderLink();
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
    expect(state.fetch).toHaveBeenLastCalledWith(
      "/issues?sessionId=s1&projectId=p1&limit=100&sort=mentioned",
    );
  });

  it("keeps the menu reachable when nothing is associated", async () => {
    state.fetch.mockResolvedValue(result(0));
    renderLink();
    const trigger = await openMenu("Issues & PRs for this session");
    expect(trigger.textContent).toBe("");
    expect(screen.getByText("Nothing found in this session yet.")).toBeTruthy();
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
  });

  it("closes the menu on Escape", async () => {
    state.fetch.mockResolvedValue(result(2));
    renderLink();
    await openMenu("2 issues and pull requests associated with this session");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows no count rather than a stale one when the count cannot be read", async () => {
    state.fetch.mockRejectedValue(new Error("offline"));
    renderLink();
    const trigger = await screen.findByRole("button", {
      name: "Issues & PRs for this session",
    });
    await waitFor(() => expect(state.fetch).toHaveBeenCalled());
    expect(trigger.textContent).toBe("");
  });

  it("follows a settling count, stops, and restarts as the transcript grows", async () => {
    vi.useFakeTimers();
    try {
      // Opening the session queues its own text, so the first answer predates
      // the references in it and the count is asked for again.
      state.fetch.mockResolvedValue(result(0, false, true));
      const { rerender } = renderLink(3);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(screen.getByRole("button").textContent).toBe("");

      state.fetch.mockResolvedValue(result(2, false, false));
      await act(() => vi.advanceTimersByTimeAsync(4000));
      expect(screen.getByRole("button").textContent).toBe("2");
      expect(state.fetch).toHaveBeenCalledTimes(2);

      // Rechecks are bounded: a quiet session stops asking instead of polling.
      await act(() => vi.advanceTimersByTimeAsync(60000));
      expect(state.fetch).toHaveBeenCalledTimes(4);

      // New messages restart them, and the known count stays on screen while
      // the next answer is pending.
      state.fetch.mockResolvedValue(result(3, false, false));
      rerender(tree(4));
      await act(() => vi.advanceTimersByTimeAsync(1000));
      expect(screen.getByRole("button").textContent).toBe("2");
      await act(() => vi.advanceTimersByTimeAsync(2000));
      expect(screen.getByRole("button").textContent).toBe("3");
      expect(state.fetch).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows tracker states once asked for, and re-reads an old list when opened", async () => {
    vi.useFakeTimers();
    try {
      const pr = (state?: "merged") => ({
        items: [
          item(1, {
            kind: "pr",
            key: "o/r#1",
            ...(state
              ? {
                  trackerStatus: {
                    state,
                    checkedAt: new Date(Date.now()).toISOString(),
                  },
                }
              : {}),
          }),
        ],
        coverage: { settings: {}, active: false, error: null, counts: [] },
        nextOffset: null,
      });
      state.fetch.mockResolvedValue({ ...pr(), statusRefreshing: true });
      renderLink();
      await act(() => vi.advanceTimersByTimeAsync(0));
      // The server is asking the tracker, so the header asks again soon.
      state.fetch.mockResolvedValue(pr("merged"));
      await act(() => vi.advanceTimersByTimeAsync(1500));
      expect(state.fetch).toHaveBeenCalledTimes(2);
      fireEvent.click(screen.getByRole("button"));
      const row = screen.getAllByRole("menuitem")[0]!;
      expect(row.textContent).toBe("o/r#1Title 1Merged");
      expect(row.getAttribute("data-tooltip")).toContain(
        "Merged on the tracker, checked 0m ago",
      );
      // A fresh list opens without a request; an old one is read again.
      expect(state.fetch).toHaveBeenCalledTimes(2);
      fireEvent.keyDown(document, { key: "Escape" });
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      const before = state.fetch.mock.calls.length;
      fireEvent.click(screen.getByRole("button"));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(state.fetch).toHaveBeenCalledTimes(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders nothing while the feature is off", () => {
    state.enabled = false;
    const { container } = renderLink();
    expect(container.textContent).toBe("");
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
