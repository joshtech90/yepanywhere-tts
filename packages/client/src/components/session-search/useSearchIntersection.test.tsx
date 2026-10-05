import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { SessionContentMatch } from "@yep-anywhere/shared";
import {
  containsSearchNeedles,
  searchNeedles,
  useSearchIntersection,
} from "./useSearchIntersection";
import { durationMs } from "./model";

afterEach(cleanup);

it("parses CSV needles, including quoted commas, and leaves literal mode intact", () => {
  expect(searchNeedles(' alpha, "beta,gamma", "say ""hi""", ', true)).toEqual([
    "alpha",
    "beta,gamma",
    'say "hi"',
  ]);
  expect(searchNeedles("alpha,beta", false)).toEqual(["alpha,beta"]);
  expect(containsSearchNeedles("Alpha\n  beta", ["alpha", "beta"])).toBe(true);
  expect(containsSearchNeedles("Alpha alone", ["alpha", "beta"])).toBe(false);
  expect(durationMs("7", Infinity)).toBe(7 * 86400000);
});

it("filters full text beyond the excerpt and restores hits without altering the first-term stream", async () => {
  const hits: SessionContentMatch[] = [
    {
      id: "a",
      role: "user",
      ordinal: 1,
      preview: "alpha",
      searchText: "alpha " + "context ".repeat(80) + "beta",
    },
    {
      id: "b",
      role: "user",
      ordinal: 2,
      preview: "alpha",
      searchText: "alpha alone",
    },
  ];
  const input = new Map([["session", hits]]);
  const { result, rerender } = renderHook(
    ({ needles }) => useSearchIntersection(input, needles),
    { initialProps: { needles: ["alpha", "beta"] } },
  );
  await waitFor(() => expect(result.current.filtering).toBe(false));
  expect(result.current.matches.get("session")?.map((hit) => hit.id)).toEqual([
    "a",
  ]);
  expect(input.get("session")).toHaveLength(2);
  rerender({ needles: ["alpha"] });
  expect(result.current.matches).toBe(input);
  rerender({ needles: ["alpha", "alone"] });
  await waitFor(() => expect(result.current.filtering).toBe(false));
  expect(result.current.matches.get("session")?.map((hit) => hit.id)).toEqual([
    "b",
  ]);
});
