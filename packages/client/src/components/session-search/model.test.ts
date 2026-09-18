import { expect, it } from "vitest";
import { limitTurnMatches, type SearchMatch } from "./model";

it("reserves an independent budget for user matches after several assistant matches", () => {
  const matches: SearchMatch[] = [
    "assistant",
    "assistant",
    "assistant",
    "user",
    "user",
  ].map((role, i) => ({
    id: String(i),
    role: role as "user" | "assistant",
    ordinal: i + 1,
    preview: "needle",
  }));
  expect(limitTurnMatches(matches, 1).map((m) => m.id)).toEqual(["0", "3"]);
  expect(limitTurnMatches(matches, 2).map((m) => m.id)).toEqual([
    "0",
    "1",
    "3",
    "4",
  ]);
  expect(limitTurnMatches(matches, Infinity)).toEqual(matches);
});
