import { expect, it } from "vitest";
import {
  effectiveInvocationError,
  effectiveToolError,
} from "../prepareDisplay";

it("prefers the result's own flag over the call status", () => {
  expect(effectiveToolError({ status: "complete", isError: true })).toBe(true);
  expect(effectiveToolError({ status: "error", isError: false })).toBe(false);
  expect(
    effectiveInvocationError({
      status: "complete",
      toolResult: { content: "denied", isError: true },
    }),
  ).toBe(true);
  expect(
    effectiveInvocationError({
      status: "error",
      toolResult: { content: "recovered", isError: false },
    }),
  ).toBe(false);
});

it("falls back to the error status when no result flag was set", () => {
  expect(effectiveToolError({ status: "error" })).toBe(true);
  expect(effectiveInvocationError({ status: "error" })).toBe(true);
  // A provider record can arrive without the flag the type declares.
  const flagless = { content: "", isError: false };
  Reflect.deleteProperty(flagless, "isError");
  expect(
    effectiveInvocationError({ status: "error", toolResult: flagless }),
  ).toBe(true);
});

it("treats pending, incomplete and aborted calls as non-failures", () => {
  for (const status of [
    "pending",
    "incomplete",
    "aborted",
    "complete",
  ] as const)
    expect(
      effectiveInvocationError({
        status,
        toolResult: { content: "", isError: false },
      }),
    ).toBe(false);
});
