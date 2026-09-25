import { describe, expect, it } from "vitest";
import { createCockpitNavigation, isCockpitPathname } from "./navigation";

describe("Cockpit navigation", () => {
  it("uses the ordinary application routes for a direct source", () => {
    const navigation = createCockpitNavigation("");
    expect(navigation).toMatchObject({
      cockpit: "/cockpit",
      sessions: "/sessions",
      projects: "/projects",
      newSession: "/new-session",
      settings: "/settings",
    });
    expect(navigation.project("project one")).toBe(
      "/sessions?project=project%20one",
    );
    expect(navigation.session("project one", "session/two")).toBe(
      "/cockpit/projects/project%20one/sessions/session%2Ftwo",
    );
    expect(navigation.classicSession("project one", "session/two")).toBe(
      "/projects/project%20one/sessions/session%2Ftwo",
    );
  });

  it("keeps every destination inside the active relay namespace", () => {
    const navigation = createCockpitNavigation("/-/relay/studio/");
    expect(navigation).toMatchObject({
      cockpit: "/-/relay/studio/cockpit",
      sessions: "/-/relay/studio/sessions",
      projects: "/-/relay/studio/projects",
      newSession: "/-/relay/studio/new-session",
      settings: "/-/relay/studio/settings",
    });
    expect(navigation.project("project one")).toBe(
      "/-/relay/studio/sessions?project=project%20one",
    );
    expect(navigation.session("project one", "session/two")).toBe(
      "/-/relay/studio/cockpit/projects/project%20one/sessions/session%2Ftwo",
    );
    expect(navigation.classicSession("project one", "session/two")).toBe(
      "/-/relay/studio/projects/project%20one/sessions/session%2Ftwo",
    );
  });

  it.each([
    ["/cockpit", true],
    ["/cockpit/projects/atlas/sessions/demo", true],
    ["/-/relay/studio/cockpit", true],
    ["/-/relay/studio/cockpit/projects/atlas/sessions/demo", true],
    ["/settings", false],
    ["/-/relay/studio/settings", false],
  ])("classifies %s as cockpit=%s", (pathname, expected) => {
    expect(isCockpitPathname(pathname)).toBe(expected);
  });
});
