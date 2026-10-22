import { expect, it } from "vitest";
import {
  projectFileLink,
  projectFileLinksSchema,
} from "../src/project-service.js";

it("encodes file paths without letting them replace the public origin or token", () => {
  const links = {
    pathTemplate: "/{path}",
    baseUrl: "https://browser.example/?ya_access=owner-token",
  };
  expect(projectFileLink(links, "research/a & b?#.md", "section")).toBe(
    "https://browser.example/research/a%20%26%20b%3F%23.md?ya_access=owner-token#section",
  );
  expect(
    projectFileLink(
      { ...links, pathTemplate: "/view?file={pathQuery}" },
      "research/a.md",
    ),
  ).toBe(
    "https://browser.example/view?file=research%2Fa.md&ya_access=owner-token",
  );
  for (const path of ["/outside.md", "../outside.md", "a/../b", "a\\b", ""]) {
    expect(projectFileLink(links, path)).toBeNull();
  }
  expect(
    projectFileLink(
      { ...links, baseUrl: "http://browser.localhost:3400/" },
      "a.md",
    ),
  ).toBeNull();
});

it("defaults an opted-in mapping and rejects templates that own credentials or origins", () => {
  expect(projectFileLinksSchema.parse({})).toEqual({
    enabled: true,
    pathTemplate: "/{path}",
  });
  expect(projectFileLinksSchema.parse({ enabled: false }).enabled).toBe(false);
  for (const pathTemplate of [
    "https://elsewhere/{path}",
    "//elsewhere/{path}",
    "/{path}?ya_access=secret",
    "/{path}?ya%5faccess=secret",
    "/../{path}",
    "/%2e%2e/{path}",
    "/{unknown}",
    "/{path}/{path}",
  ]) {
    expect(projectFileLinksSchema.safeParse({ pathTemplate }).success).toBe(
      false,
    );
  }
});
