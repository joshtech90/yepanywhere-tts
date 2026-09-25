import { beforeEach, describe, expect, it } from "vitest";
import {
  activateCockpitView,
  readCockpitOrganization,
  removeCockpitOrganizationSource,
  removeCockpitView,
  saveCockpitView,
} from "./organization";

beforeEach(() => localStorage.clear());

describe("Cockpit organization storage", () => {
  it("keeps saved views isolated by source across reloads", () => {
    saveCockpitView("host:alpha", {
      id: "view-alpha",
      label: "Fictional release",
      query: "release",
      pinnedOnly: true,
    });
    saveCockpitView("host:beta", {
      id: "view-beta",
      label: "Fictional notes",
      query: "notes",
      pinnedOnly: false,
    });

    expect(readCockpitOrganization("host:alpha")).toEqual({
      activeViewId: "view-alpha",
      views: [
        {
          id: "view-alpha",
          label: "Fictional release",
          query: "release",
          pinnedOnly: true,
        },
      ],
    });
    expect(readCockpitOrganization("host:beta").views[0]?.id).toBe(
      "view-beta",
    );
  });

  it("falls back safely for unknown storage versions", () => {
    localStorage.setItem(
      "yep-anywhere-cockpit-organization",
      JSON.stringify({ version: 99, sources: { local: { views: [] } } }),
    );
    expect(readCockpitOrganization("local")).toEqual({
      activeViewId: null,
      views: [],
    });
  });

  it("removes one host without changing another host's views", () => {
    saveCockpitView("host:alpha", {
      id: "view-alpha",
      label: "Alpha",
      query: "alpha",
      pinnedOnly: false,
    });
    saveCockpitView("host:beta", {
      id: "view-beta",
      label: "Beta",
      query: "beta",
      pinnedOnly: false,
    });

    removeCockpitOrganizationSource("host:alpha");

    expect(readCockpitOrganization("host:alpha").views).toEqual([]);
    expect(readCockpitOrganization("host:beta").views[0]?.id).toBe(
      "view-beta",
    );
  });

  it("clears active state when an active view is removed", () => {
    saveCockpitView("local", {
      id: "view-1",
      label: "Review",
      query: "review",
      pinnedOnly: false,
    });
    activateCockpitView("local", "view-1");

    expect(removeCockpitView("local", "view-1")).toEqual({
      activeViewId: null,
      views: [],
    });
  });
});
