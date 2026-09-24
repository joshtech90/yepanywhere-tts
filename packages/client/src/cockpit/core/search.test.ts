import type { SessionContentMatch } from "@yep-anywhere/shared";
import { describe, expect, it } from "vitest";
import type { GlobalSessionItem } from "../../api/client";
import { createCockpitSearchResults } from "./search";

function session(id: string, title: string): GlobalSessionItem {
  return {
    id,
    title,
    fullTitle: title,
    createdAt: "2026-09-24T12:00:00.000Z",
    updatedAt: "2026-09-24T12:00:00.000Z",
    messageCount: 2,
    provider: "claude",
    projectId: "atlas",
    projectName: "Atlas",
    ownership: { owner: "none" },
  };
}

describe("Cockpit search projection", () => {
  it("groups title and turn matches by session", () => {
    const turn: SessionContentMatch = {
      id: "turn-1",
      role: "assistant",
      ordinal: 1,
      preview: "The deployment checklist is ready.",
      timestamp: "2026-09-24T12:01:00.000Z",
    };
    const results = createCockpitSearchResults({
      sessions: [session("one", "Deployment checklist")],
      query: "checklist",
      fields: ["title", "assistant"],
      contentMatches: new Map([["one", [turn]]]),
      discoveryOrder: new Map(),
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.titleMatched).toBe(true);
    expect(results[0]?.matches.map((match) => match.role)).toEqual([
      "title",
      "assistant",
    ]);
  });

  it("keeps existing groups in place when a new match arrives", () => {
    const order = new Map<string, number>();
    const first = session("first", "Research notes");
    const arriving = session("arriving", "Research archive");

    expect(
      createCockpitSearchResults({
        sessions: [first],
        query: "research",
        fields: ["title"],
        contentMatches: new Map(),
        discoveryOrder: order,
      }).map((result) => result.session.id),
    ).toEqual(["first"]);

    expect(
      createCockpitSearchResults({
        sessions: [arriving, first],
        query: "research",
        fields: ["title"],
        contentMatches: new Map(),
        discoveryOrder: order,
      }).map((result) => result.session.id),
    ).toEqual(["first", "arriving"]);
  });
});
