import { describe, expect, it } from "vitest";
import {
  directoryNameFor,
  isProjectDescription,
  joinUnderBase,
  pathForProjectName,
  settlePathEntry,
} from "./newProjectPath";

const projects = [
  { path: "/home/u/dragon-story", name: "Dragon Story" },
  { path: "/home/u/code/yep", name: "yep" },
];

describe("directoryNameFor", () => {
  it("lowercases and joins words with a hyphen", () => {
    expect(directoryNameFor("My Dragon Story!")).toBe("my-dragon-story");
    expect(directoryNameFor("  café  au_lait ")).toBe("cafe-au_lait");
  });

  it("caps the length without a trailing separator", () => {
    const name = directoryNameFor(
      "a story about a dragon who learns to bake bread in the mountains",
    );
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name).toBe("a-story-about-a-dragon-who-learns-to-bak");
    expect(directoryNameFor(`${"x".repeat(39)} y`)).toBe("x".repeat(39));
  });
});

describe("isProjectDescription", () => {
  it("is whitespace without any path separator or anchor", () => {
    expect(isProjectDescription("my dragon story")).toBe(true);
    expect(isProjectDescription("story1")).toBe(false);
    expect(isProjectDescription("code/my story")).toBe(false);
    expect(isProjectDescription("~/my story")).toBe(false);
  });
});

describe("joinUnderBase", () => {
  it("uses the base's own separator", () => {
    expect(joinUnderBase("~", "story1")).toBe("~/story1");
    expect(joinUnderBase("/srv/kids/", "story1")).toBe("/srv/kids/story1");
    expect(joinUnderBase("C:\\Users\\kid", "story1")).toBe(
      "C:\\Users\\kid\\story1",
    );
  });
});

describe("pathForProjectName", () => {
  it("means the existing project when its name is typed again", () => {
    expect(pathForProjectName("dragon STORY", "~", projects)).toBe(
      "/home/u/dragon-story",
    );
  });

  it("makes a new directory when only the directory name collides", () => {
    expect(pathForProjectName("Dragon story!", "~", projects)).toBe(
      "~/dragon-story-2",
    );
    expect(
      pathForProjectName("Dragon story!", "~", [
        ...projects,
        { path: "/elsewhere/dragon-story-2", name: "x" },
      ]),
    ).toBe("~/dragon-story-3");
  });

  it("keeps a suffixed truncated name within the length cap", () => {
    const long = "a story about a dragon who learns to bake bread";
    const first = pathForProjectName(long, "~", []);
    const taken = [{ path: first.replace("~", "/home/u"), name: long }];
    const second = pathForProjectName(`${long} again`, "~", taken);
    expect(second).toBe("~/a-story-about-a-dragon-who-learns-to-b-2");
  });
});

describe("settlePathEntry", () => {
  it("leaves anchored paths alone", () => {
    expect(settlePathEntry(" /tmp/x ", "~", projects)).toEqual({
      path: "/tmp/x",
    });
    expect(settlePathEntry("~/code/x", "/srv", projects)).toEqual({
      path: "~/code/x",
    });
  });

  it("puts a relative entry under the base", () => {
    expect(settlePathEntry("story1", "~", projects)).toEqual({
      path: "~/story1",
    });
    expect(settlePathEntry("code/x", "/srv/kid", projects)).toEqual({
      path: "/srv/kid/code/x",
    });
  });

  it("reads a description as a name", () => {
    expect(settlePathEntry("My Cat Game", "~/kid", projects)).toEqual({
      path: "~/kid/my-cat-game",
      name: "My Cat Game",
    });
  });
});
