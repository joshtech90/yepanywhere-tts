import { describe, expect, it } from "vitest";
import {
  EMPTY_LIMITED_USER_GRANTS,
  isPathWithin,
  projectAccessLevel,
  withPathGrantProjects,
  type LimitedUserGrants,
} from "../src/limited-users.js";
import { toUrlProjectId } from "../src/projectId.js";

const kids = toUrlProjectId("/home/me/kids/game");
const nested = toUrlProjectId("/home/me/kids/2026/art");
const sibling = toUrlProjectId("/home/me/kidsville");
const elsewhere = toUrlProjectId("/home/me/work");

function grants(overrides: Partial<LimitedUserGrants>): LimitedUserGrants {
  return { ...EMPTY_LIMITED_USER_GRANTS, ...overrides };
}

describe("directory grants", () => {
  it("cover the directory and everything beneath it, and nothing beside it", () => {
    const g = grants({
      pathGrants: [{ path: "/home/me/kids", level: "join" }],
    });
    expect(projectAccessLevel(g, kids)).toBe("join");
    expect(projectAccessLevel(g, nested)).toBe("join");
    expect(projectAccessLevel(g, sibling)).toBe("none");
    expect(projectAccessLevel(g, elsewhere)).toBe("none");
  });

  it("combine with per-project grants at the higher level", () => {
    const g = grants({
      newSessionProjects: [kids],
      viewProjects: [nested],
      pathGrants: [{ path: "/home/me/kids/", level: "join" }],
    });
    expect(projectAccessLevel(g, kids)).toBe("new-session");
    expect(projectAccessLevel(g, nested)).toBe("join");
  });

  it("refuse spellings that climb out of the directory", () => {
    expect(isPathWithin("/home/me/kids", "/home/me/kids/../work")).toBe(false);
    expect(isPathWithin("/home/me/kids", "relative/kids")).toBe(false);
    expect(
      projectAccessLevel(
        grants({ pathGrants: [{ path: "/home/me/kids", level: "view" }] }),
        "p1",
      ),
    ).toBe("none");
  });

  it("write covered known projects into the lists that enumerate a user's projects", () => {
    const g = withPathGrantProjects(
      grants({
        viewProjects: [kids],
        pathGrants: [{ path: "/home/me/kids", level: "new-session" }],
      }),
      [
        { id: kids, path: "/home/me/kids/game" },
        { id: nested, path: "/home/me/kids/2026/art" },
        { id: elsewhere, path: "/home/me/work" },
      ],
    );
    expect(new Set(g.newSessionProjects)).toEqual(new Set([kids, nested]));
    expect(g.viewProjects).toEqual([kids]);
    expect(g.joinProjects).toEqual([]);
  });
});
