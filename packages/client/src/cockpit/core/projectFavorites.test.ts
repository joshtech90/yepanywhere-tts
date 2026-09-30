import { describe, expect, it } from "vitest";
import {
  addFavorite,
  defaultFavoriteLabel,
  findFavorite,
  folderKey,
  projectForFolder,
  removeFavorite,
  renameFavorite,
} from "./projectFavorites";

describe("Cockpit project favourites", () => {
  const favorites = [
    { path: "/Users/j/Projects/Smartzone OS", label: "SZ OS" },
    { path: "/Users/j/Projects/China Autos", label: "China Autos" },
  ];

  it("matches folders regardless of a trailing slash", () => {
    expect(folderKey("/a/b/")).toBe("/a/b");
    expect(folderKey("/")).toBe("/");
    expect(findFavorite(favorites, "/Users/j/Projects/Smartzone OS/")).toBe(
      favorites[0],
    );
  });

  it("names a new favourite after its folder and never adds one twice", () => {
    expect(defaultFavoriteLabel("/Users/j/Projects/yepanywhere/")).toBe(
      "yepanywhere",
    );
    const added = addFavorite(favorites, "/Users/j/Projects/yepanywhere");
    expect(added.at(-1)).toEqual({
      path: "/Users/j/Projects/yepanywhere",
      label: "yepanywhere",
    });
    expect(addFavorite(added, "/Users/j/Projects/yepanywhere/")).toHaveLength(
      3,
    );
  });

  it("renames and removes by folder, leaving the others alone", () => {
    expect(
      renameFavorite(favorites, "/Users/j/Projects/China Autos", " CA "),
    ).toEqual([favorites[0], { ...favorites[1], label: "CA" }]);
    expect(
      renameFavorite(favorites, "/Users/j/Projects/China Autos", "  "),
    ).toEqual(favorites);
    expect(removeFavorite(favorites, "/Users/j/Projects/Smartzone OS")).toEqual(
      [favorites[1]],
    );
  });

  it("finds the known project in a favourite's folder", () => {
    const projects = [
      { id: "p1", path: "/Users/j/Projects/China Autos" },
      { id: "p2", path: "/Users/j/Projects/Other" },
    ];
    expect(
      projectForFolder(projects, "/Users/j/Projects/China Autos/")?.id,
    ).toBe("p1");
    expect(projectForFolder(projects, "/Users/j/Projects/New")).toBeUndefined();
  });
});
