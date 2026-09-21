import { describe, expect, it } from "vitest";
import type { RetainedSessionCollectionState } from "@yep-anywhere/shared";
import { catalogLoadState } from "../clientSummaryCollections";

function catalog(
  overrides: Partial<RetainedSessionCollectionState> = {},
): RetainedSessionCollectionState {
  return {
    catalogEpoch: "epoch",
    catalogGeneration: 1,
    complete: true,
    refreshing: false,
    ...overrides,
  };
}

describe("catalogLoadState", () => {
  it("keeps an empty list loading while a cold catalog fills", () => {
    const state = catalogLoadState(
      catalog({ complete: false, refreshing: true }),
      0,
    );
    expect(state.awaitingFirstRows).toBe(true);
    expect(state.refreshError).toBeNull();
  });

  it("stops waiting once the catalog has produced rows", () => {
    expect(
      catalogLoadState(catalog({ complete: false, refreshing: true }), 3)
        .awaitingFirstRows,
    ).toBe(false);
  });

  it("answers an empty complete catalog rather than waiting", () => {
    expect(catalogLoadState(catalog(), 0).awaitingFirstRows).toBe(false);
  });

  it("waits for nothing when the collection has no catalog", () => {
    const state = catalogLoadState(undefined, 0);
    expect(state.awaitingFirstRows).toBe(false);
    expect(state.refreshError).toBeNull();
  });

  it("surfaces a failed refresh as an error", () => {
    const state = catalogLoadState(catalog({ refreshError: "scan failed" }), 0);
    expect(state.refreshError?.message).toBe("scan failed");
  });
});
