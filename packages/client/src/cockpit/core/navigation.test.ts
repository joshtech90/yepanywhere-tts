import { describe, expect, it } from "vitest";
import { createCockpitNavigation, isCockpitPathname } from "./navigation";

describe("Cockpit navigation", () => {
  it("keeps list views inside the Cockpit for a direct source", () => {
    const navigation = createCockpitNavigation("");
    expect(navigation).toMatchObject({
      cockpit: "/cockpit",
      sessions: "/cockpit?view=sessions",
      projects: "/cockpit?view=projects",
      classicSessions: "/sessions",
      hidden: "/cockpit?view=hidden",
      newSession: "/cockpit?view=new",
      settings: "/settings",
    });
    expect(navigation.project("project one")).toBe(
      "/cockpit?view=sessions&project=project%20one",
    );
    expect(navigation.newSessionIn("project one")).toBe(
      "/cockpit?view=new&project=project%20one",
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
      sessions: "/-/relay/studio/cockpit?view=sessions",
      projects: "/-/relay/studio/cockpit?view=projects",
      classicSessions: "/-/relay/studio/sessions",
      hidden: "/-/relay/studio/cockpit?view=hidden",
      newSession: "/-/relay/studio/cockpit?view=new",
      settings: "/-/relay/studio/settings",
    });
    expect(navigation.project("project one")).toBe(
      "/-/relay/studio/cockpit?view=sessions&project=project%20one",
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
