import assert from "node:assert/strict";
import test from "node:test";
import {
  reportedYaVersion,
  selectBundledYaVersion,
} from "./runtime-manifest.mjs";

test("a packaged server reports release-shaped versions without the v", () => {
  assert.equal(reportedYaVersion("v0.7.0-204-g02856e2c"), "0.7.0-204-g02856e2c");
  assert.equal(reportedYaVersion("0.7.0"), "0.7.0");
});

test("a build without release tags reports an unknown version", () => {
  assert.equal(reportedYaVersion("98ab07df6"), "unknown");
  assert.equal(reportedYaVersion("98ab07df6-dirty"), "unknown");
  assert.equal(reportedYaVersion("unknown"), "unknown");
});

test("the bundled YA version prefers the exact git build description", () => {
  assert.equal(
    selectBundledYaVersion("v0.7.0-204-g02856e2c", "0.7.0"),
    "v0.7.0-204-g02856e2c",
  );
});

test("the package version is only a fallback without git metadata", () => {
  assert.equal(selectBundledYaVersion("unknown", "0.7.0"), "0.7.0");
  assert.equal(selectBundledYaVersion("", ""), "unknown");
});
