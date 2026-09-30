import { describe, expect, it, vi } from "vitest";
import {
  drainManagedRoutes,
  routeWithDrain,
} from "../../../client/e2e/support/managed-routes.js";

describe("E2E intercepted request lifetime", () => {
  it("settles sibling callbacks before reporting a rejected callback", async () => {
    let callback!: (route: unknown, request: unknown) => Promise<unknown>;
    const page = {
      route: vi.fn(async (_matcher, handler) => {
        callback = handler;
      }),
    } as unknown as Parameters<typeof routeWithDrain>[0];
    let rejectFirst!: (reason: Error) => void;
    let finishSecond!: () => void;
    const first = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const second = new Promise<void>((resolve) => {
      finishSecond = resolve;
    });
    await routeWithDrain(page, "**/*", (_route, request) =>
      request === ("first" as unknown) ? first : second,
    );
    const failed = callback({}, "first").catch(() => undefined);
    const pending = callback({}, "second");
    let drained = false;
    const draining = drainManagedRoutes(page).catch((error) => {
      drained = true;
      return error;
    });
    rejectFirst(new Error("first handler failed"));
    await failed;
    expect(drained).toBe(false);
    finishSecond();
    await pending;
    const error = await draining;
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toHaveLength(1);
    expect(error.errors[0].message).toBe("first handler failed");
  });
});
