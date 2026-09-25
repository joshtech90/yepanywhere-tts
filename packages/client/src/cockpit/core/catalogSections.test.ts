import { describe, expect, it } from "vitest";
import type { CockpitCatalogSession, CockpitCatalogView } from "./catalog";
import {
  flattenCockpitCatalog,
  markCockpitSessionWorkingElsewhere,
  splitCockpitFavorites,
} from "./catalogSections";

function session(id: string, pinned = false): CockpitCatalogSession {
  return {
    key: `local\0session\0${id}`,
    id,
    projectId: "p",
    title: id,
    pinned,
    status: "complete",
  };
}

const catalog: CockpitCatalogView = {
  sourceKey: "local",
  sessionCount: 5,
  projects: [
    {
      key: "a",
      id: "a",
      name: "Android",
      path: "/a",
      sessions: [session("a1", true), session("a2")],
    },
    {
      key: "b",
      id: "b",
      name: "Buero",
      path: "/b",
      sessions: [session("b1", true)],
    },
    { key: "c", id: "c", name: "Cloud", path: "/c", sessions: [] },
    {
      key: "d",
      id: "d",
      name: "Docs",
      path: "/d",
      sessions: [session("d1"), session("d2", true)],
    },
  ],
};

describe("splitCockpitFavorites", () => {
  it("puts favourites first and every other session after, by time", () => {
    const timed: CockpitCatalogView = {
      ...catalog,
      projects: catalog.projects.map((project) => ({
        ...project,
        sessions: project.sessions.map((item, index) => ({
          ...item,
          lastActivityAt: new Date(
            Date.UTC(2026, 8, 20 + index, item.id.charCodeAt(0) - 96),
          ).toISOString(),
        })),
      })),
    };
    const sections = splitCockpitFavorites(timed);

    expect(
      sections.favorites.map((item) => [item.session.id, item.projectName]),
    ).toEqual([
      ["d2", "Docs"],
      ["b1", "Buero"],
      ["a1", "Android"],
    ]);
    expect(sections.others.map((item) => item.session.id)).toEqual([
      "a2",
      "d1",
    ]);
  });
});

describe("flattenCockpitCatalog", () => {
  it("orders every session by its latest activity", () => {
    const withTimes: CockpitCatalogView = {
      ...catalog,
      projects: catalog.projects.map((project) => ({
        ...project,
        sessions: project.sessions.map((item, index) => ({
          ...item,
          lastActivityAt: new Date(
            Date.UTC(2026, 8, 20 + index, item.id.charCodeAt(0) - 96),
          ).toISOString(),
        })),
      })),
    };
    expect(
      flattenCockpitCatalog(withTimes).map((item) => item.session.id),
    ).toEqual(["d2", "a2", "d1", "b1", "a1"]);
  });
});

describe("markCockpitSessionWorkingElsewhere", () => {
  it("turns only the open, otherwise idle session green", () => {
    const marked = markCockpitSessionWorkingElsewhere(catalog, "a2");
    expect(
      marked.projects[0]?.sessions.map((item) => [item.id, item.status]),
    ).toEqual([
      ["a1", "complete"],
      ["a2", "external"],
    ]);
    expect(marked.projects[1]).toBe(catalog.projects[1]);
  });

  it("leaves the catalogue untouched without a working session", () => {
    expect(markCockpitSessionWorkingElsewhere(catalog, null)).toBe(catalog);
    expect(markCockpitSessionWorkingElsewhere(catalog, "missing")).toBe(
      catalog,
    );
  });
});
