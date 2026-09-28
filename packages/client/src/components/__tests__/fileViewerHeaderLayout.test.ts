import { describe, expect, it } from "vitest";
import { shouldStackFileViewerActions } from "../fileViewerHeaderLayout";

describe("shouldStackFileViewerActions", () => {
  const actionWidths = [36, 36, 36, 36, 36, 36, 36, 36];

  it("shares the context row when that removes a row", () => {
    expect(
      shouldStackFileViewerActions({
        actionGap: 2,
        actionWidths,
        availableWidth: 840,
        contextWidth: 36,
        headerGap: 8,
        provenanceWidth: 150,
      }),
    ).toBe(false);
  });

  it("takes the soft break when sharing would not save vertical space", () => {
    expect(
      shouldStackFileViewerActions({
        actionGap: 2,
        actionWidths,
        availableWidth: 351,
        contextWidth: 36,
        headerGap: 8,
        provenanceWidth: 150,
      }),
    ).toBe(true);
  });
});
