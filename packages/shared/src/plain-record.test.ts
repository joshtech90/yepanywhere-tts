import { describe, expect, it } from "vitest";
import { asRecord, isRecord } from "./plain-record.js";

describe("plain record", () => {
  it("accepts a keyed object", () => {
    const value: unknown = { stdout: "hi" };
    expect(isRecord(value)).toBe(true);
    expect(asRecord(value)).toBe(value);
  });

  it("rejects an array, so an indexable value is not read as keyed", () => {
    expect(isRecord([{ stdout: "hi" }])).toBe(false);
    expect(asRecord([{ stdout: "hi" }])).toBeNull();
  });

  it("rejects null and primitives", () => {
    for (const value of [null, undefined, "text", 3, false]) {
      expect(isRecord(value)).toBe(false);
      expect(asRecord(value)).toBeNull();
    }
  });
});
