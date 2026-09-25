import { describe, expect, it } from "vitest";
import { projectLabelFromId } from "./CockpitSessionDetail";

describe("projectLabelFromId", () => {
  it("uses the last path segment of a base64url project id", () => {
    // "/home/demo/Projects/AI Worker", base64url without padding
    expect(projectLabelFromId("L2hvbWUvZGVtby9Qcm9qZWN0cy9BSSBXb3JrZXI")).toBe(
      "AI Worker",
    );
  });

  it("keeps non-ASCII path names intact", () => {
    const id = btoa(
      String.fromCharCode(...new TextEncoder().encode("/tmp/Übersicht")),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(projectLabelFromId(id)).toBe("Übersicht");
  });

  it("returns undefined for ids that are not encoded paths", () => {
    expect(projectLabelFromId("%%%")).toBeUndefined();
  });
});
