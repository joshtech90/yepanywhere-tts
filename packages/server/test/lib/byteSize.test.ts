import { expect, it } from "vitest";
import { parseByteSize } from "../../src/lib/byteSize.js";

it("reads sizes with and without a binary suffix", () => {
  expect(parseByteSize("256M", 0)).toBe(256 * 1024 * 1024);
  expect(parseByteSize("1g", 0)).toBe(1024 ** 3);
  expect(parseByteSize("4096", 0)).toBe(4096);
  expect(parseByteSize(undefined, 17)).toBe(17);
  expect(parseByteSize("", 17)).toBe(17);
  expect(() => parseByteSize("many", 0)).toThrow();
});
