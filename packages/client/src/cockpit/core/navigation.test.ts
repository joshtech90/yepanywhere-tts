import { describe, expect, it } from "vitest";
import { createCockpitNavigation } from "./navigation";

describe("Cockpit navigation", () => {
  it("uses the ordinary application routes for a direct source", () => {
    expect(createCockpitNavigation("")).toEqual({
      cockpit: "/cockpit",
      sessions: "/sessions",
      projects: "/projects",
      newSession: "/new-session",
      settings: "/settings",
    });
  });

  it("keeps every destination inside the active relay namespace", () => {
    expect(createCockpitNavigation("/-/relay/studio/")).toEqual({
      cockpit: "/-/relay/studio/cockpit",
      sessions: "/-/relay/studio/sessions",
      projects: "/-/relay/studio/projects",
      newSession: "/-/relay/studio/new-session",
      settings: "/-/relay/studio/settings",
    });
  });
});
