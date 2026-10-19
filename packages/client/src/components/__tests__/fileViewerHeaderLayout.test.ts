import { describe, expect, it } from "vitest";
import { fileViewerWindowControlsFit } from "../fileViewerHeaderLayout";

describe("fileViewerWindowControlsFit", () => {
  const widths = {
    availableWidth: 404,
    contextWidth: 24,
    headerGap: 2,
    filenameWidth: 280,
    provenanceWidth: 150,
    windowWidth: 96,
  };

  it("uses spare title width only when the complete filename fits", () => {
    expect(fileViewerWindowControlsFit(widths)).toBe(true);
    expect(
      fileViewerWindowControlsFit({ ...widths, availableWidth: 403 }),
    ).toBe(false);
  });

  it("also preserves the revision/stats row even with a short filename", () => {
    expect(
      fileViewerWindowControlsFit({
        ...widths,
        filenameWidth: 30,
        provenanceWidth: 281,
      }),
    ).toBe(false);
    expect(fileViewerWindowControlsFit({ ...widths, windowWidth: 0 })).toBe(
      false,
    );
  });
});
