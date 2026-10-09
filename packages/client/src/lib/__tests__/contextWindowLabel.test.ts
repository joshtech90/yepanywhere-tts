import { describe, expect, it } from "vitest";
import { formatContextWindowLabel } from "../contextWindowLabel";

describe("formatContextWindowLabel", () => {
  it("uses decimal units", () => {
    expect(formatContextWindowLabel(1_000_000)).toBe("1M ctx");
    expect(formatContextWindowLabel(200_000)).toBe("200K ctx");
    expect(formatContextWindowLabel(131_072)).toBe("131K ctx");
    expect(formatContextWindowLabel(1_500_000)).toBe("1.5M ctx");
  });
});
