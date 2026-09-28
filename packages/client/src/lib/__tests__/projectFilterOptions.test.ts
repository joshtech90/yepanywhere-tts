import { describe, expect, it } from "vitest";
import { groupProjectsForFilter } from "../projectFilterOptions";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-23T12:00:00Z");
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

describe("groupProjectsForFilter", () => {
  it("folds stale and barely-used projects below busy ones, each alphabetical", () => {
    const projects = [
      { id: "z", name: "zeta" },
      { id: "s", name: "stale" },
      { id: "b", name: "busy" },
      { id: "n", name: "new" },
      { id: "f", name: "few" },
      { id: "e", name: "empty" },
    ];
    const sessions = [
      { projectId: "z", updatedAt: at(1) },
      { projectId: "z", updatedAt: at(2) },
      { projectId: "z", updatedAt: at(5) },
      { projectId: "s", updatedAt: at(30) },
      { projectId: "s", updatedAt: at(40) },
      { projectId: "s", updatedAt: at(50) },
      { projectId: "b", updatedAt: at(10) },
      { projectId: "b", updatedAt: at(11) },
      { projectId: "b", updatedAt: at(12) },
      { projectId: "n", updatedAt: at(0.5) },
      { projectId: "f", updatedAt: at(8) },
    ];
    const { current, older } = groupProjectsForFilter(projects, sessions, NOW);
    expect(current.map((p) => p.name)).toEqual(["busy", "new", "zeta"]);
    expect(older.map((p) => p.name)).toEqual(["empty", "few", "stale"]);
  });
});
