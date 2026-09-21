import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLEARLOOP_INACTIVITY_SECONDS,
  MAX_CLEARLOOP_INACTIVITY_SECONDS,
  MIN_CLEARLOOP_INACTIVITY_SECONDS,
  clampClearloopInactivitySeconds,
  formatDurationSeconds,
  parseClearloopArguments,
  parseDurationSeconds,
  parseTurnIndexArgument,
} from "../session-rewind.js";

describe("session-rewind durations", () => {
  it("parses s/m/h suffixes and bare seconds", () => {
    expect(parseDurationSeconds("45s")).toBe(45);
    expect(parseDurationSeconds("2m")).toBe(120);
    expect(parseDurationSeconds("1h")).toBe(3600);
    expect(parseDurationSeconds("1.5m")).toBe(90);
    expect(parseDurationSeconds(" 30 ")).toBe(30);
    expect(parseDurationSeconds("")).toBeNull();
    expect(parseDurationSeconds("5d")).toBeNull();
    expect(parseDurationSeconds("abc")).toBeNull();
  });

  it("formats the shortest exact unit", () => {
    expect(formatDurationSeconds(45)).toBe("45s");
    expect(formatDurationSeconds(120)).toBe("2m");
    expect(formatDurationSeconds(3600)).toBe("1h");
    expect(formatDurationSeconds(90)).toBe("90s");
  });

  it("clamps the inactivity window to its range", () => {
    expect(clampClearloopInactivitySeconds(undefined)).toBeUndefined();
    expect(clampClearloopInactivitySeconds(Number.NaN)).toBeUndefined();
    expect(clampClearloopInactivitySeconds(1)).toBe(
      MIN_CLEARLOOP_INACTIVITY_SECONDS,
    );
    expect(clampClearloopInactivitySeconds(99999)).toBe(
      MAX_CLEARLOOP_INACTIVITY_SECONDS,
    );
    expect(
      clampClearloopInactivitySeconds(DEFAULT_CLEARLOOP_INACTIVITY_SECONDS),
    ).toBe(DEFAULT_CLEARLOOP_INACTIVITY_SECONDS);
  });
});

describe("session-rewind command arguments", () => {
  it("parses /clearloop with and without a turn index", () => {
    expect(parseClearloopArguments("3 2: try again")).toEqual({
      turnIndex: 3,
      total: 2,
      prompt: "try again",
    });
    expect(parseClearloopArguments("2: try again")).toEqual({
      total: 2,
      prompt: "try again",
    });
    expect(parseClearloopArguments("2:multi\nline")).toEqual({
      total: 2,
      prompt: "multi\nline",
    });
  });

  it("rejects malformed /clearloop arguments", () => {
    expect(parseClearloopArguments("")).toBeNull();
    expect(parseClearloopArguments("2 try again")).toBeNull();
    expect(parseClearloopArguments("0: prompt")).toBeNull();
    expect(parseClearloopArguments("3 2:")).toBeNull();
  });

  it("parses /clear and /fork turn indexes", () => {
    expect(parseTurnIndexArgument("", { allowEmpty: true })).toBe(0);
    expect(parseTurnIndexArgument("", { allowEmpty: false })).toBeNull();
    expect(parseTurnIndexArgument(" 7 ", { allowEmpty: false })).toBe(7);
    expect(parseTurnIndexArgument("x", { allowEmpty: true })).toBeNull();
  });
});
