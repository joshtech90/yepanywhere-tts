import { describe, expect, it } from "vitest";
import { isAutomaticSessionResumeAllowed } from "../../src/sessions/resume-exemption.js";

describe("resume exemption", () => {
  describe("isAutomaticSessionResumeAllowed", () => {
    it("blocks only sessions with the durable automatic-resume exemption", () => {
      expect(isAutomaticSessionResumeAllowed(undefined)).toBe(true);
      expect(isAutomaticSessionResumeAllowed({})).toBe(true);
      expect(
        isAutomaticSessionResumeAllowed({ autoResumeDisabled: true }),
      ).toBe(false);
      expect(
        isAutomaticSessionResumeAllowed({
          automationPausedUntilUserTurn: true,
        }),
      ).toBe(false);
    });
  });
});
