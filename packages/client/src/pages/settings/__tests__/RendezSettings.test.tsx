// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RendezSettings, type RendezSettingsValue } from "../RendezSettings";

vi.mock("../../../i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

afterEach(cleanup);

const projects = [
  { path: "/work/draft", name: "draft" },
  { path: "/work/ya", name: "ya" },
  { path: "/work/agents", name: "agents" },
  { path: "/work/pii", name: "pii" },
];

function show(
  value: RendezSettingsValue,
  watching: ReadonlySet<string> | null = new Set(["/work/draft"]),
) {
  const onChange = vi.fn();
  render(
    <RendezSettings
      value={value}
      projects={projects}
      watching={watching}
      saving={false}
      onChange={onChange}
    />,
  );
  return onChange;
}

const rowNames = () =>
  screen
    .queryAllByRole("row")
    .slice(1)
    .map((row) => row.querySelector("strong")?.textContent);

it("opens on the overrides that differ from the default, then shows all", () => {
  // With the default off, an Off override changes nothing and stays hidden.
  show({
    enabled: false,
    projects: { "/work/draft": true, "/work/ya": true, "/work/pii": false },
  });
  expect(rowNames()).toEqual(["draft", "ya"]);
  expect(screen.getByText(/rendezWatching/)).toBeTruthy();
  expect(screen.getByText("rendezWaitingForMessage")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /rendezShowAll/ }));
  // Overrides first, then inheriting projects, each by name.
  expect(rowNames()).toEqual(["draft", "pii", "ya", "agents"]);
  expect(
    screen.getByText('rendezWatchedCount {"watched":2,"total":4}'),
  ).toBeTruthy();
});

it("writes On and Off as entries and Inherit as no entry", () => {
  const onChange = show({ enabled: false, projects: { "/work/draft": true } });
  fireEvent.click(screen.getByRole("button", { name: /rendezShowAll/ }));

  fireEvent.click(screen.getByRole("radio", { name: "agents: rendezOff" }));
  expect(onChange).toHaveBeenLastCalledWith({
    enabled: false,
    projects: { "/work/draft": true, "/work/agents": false },
  });
  fireEvent.click(screen.getByRole("radio", { name: "draft: rendezInherit" }));
  expect(onChange).toHaveBeenLastCalledWith({ enabled: false, projects: {} });
});

it("clears every override with All inherit, including unknown paths", () => {
  const onChange = show({
    enabled: true,
    projects: { "/work/ya": false, "/gone/old": true },
  });
  fireEvent.click(screen.getByRole("button", { name: /rendezShowAll/ }));
  // A configured path that is no longer a project still lists, to be cleared.
  expect(rowNames()).toContain("old");
  fireEvent.click(screen.getByRole("button", { name: "rendezAllInherit" }));
  expect(onChange).toHaveBeenLastCalledWith({ enabled: true, projects: {} });
});

it("shows no live status when the server does not report it", () => {
  show({ enabled: false, projects: { "/work/draft": true } }, null);
  expect(rowNames()).toEqual(["draft"]);
  expect(screen.queryByText(/rendezWatching/)).toBeNull();
  expect(screen.queryByText("rendezWaitingForMessage")).toBeNull();
});
