import { describe, expect, it } from "vitest";
import { projectDisplayName } from "../limited-users.js";

/** Contract: topics/limited-users.md § Delivery v1 — Project creation. */

describe("projectDisplayName", () => {
  it("prefixes a limited user's project with whose it is", () => {
    expect(projectDisplayName({ name: "notes", ownerUsername: "archer" })).toBe(
      "archer/notes",
    );
  });

  it("leaves the superuser's projects alone", () => {
    expect(projectDisplayName({ name: "notes" })).toBe("notes");
    expect(projectDisplayName({ name: "notes", ownerUsername: "" })).toBe(
      "notes",
    );
  });
});
