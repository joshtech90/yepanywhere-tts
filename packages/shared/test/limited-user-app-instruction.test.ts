import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITED_USER_APP_INSTRUCTION,
  LIMITED_USER_SERVER_APP_EXAMPLE,
  LIMITED_USER_STATIC_APP_EXAMPLE,
  defaultLimitedUserInstructions,
  instructionBlocksError,
} from "../src/limited-users.js";
import { projectServiceSchema } from "../src/project-service.js";

describe("limited-user App instruction", () => {
  it("teaches declarations the service loader accepts", () => {
    for (const example of [
      LIMITED_USER_STATIC_APP_EXAMPLE,
      LIMITED_USER_SERVER_APP_EXAMPLE,
    ]) {
      expect(projectServiceSchema.safeParse(example.service).success).toBe(
        true,
      );
      expect(DEFAULT_LIMITED_USER_APP_INSTRUCTION).toContain(
        JSON.stringify(example),
      );
    }
  });

  it("ships inside a valid default policy", () => {
    const defaults = defaultLimitedUserInstructions();
    expect(defaults.blocks).toContain(DEFAULT_LIMITED_USER_APP_INSTRUCTION);
    expect(instructionBlocksError(defaults.blocks)).toBeNull();
  });
});
