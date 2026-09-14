import { Hono } from "hono";
import { z } from "zod";
import type { ComputerControlService } from "../computer-control/service.js";

/** Separate capability from the original local-package preview routes. */
export function createComputerControlReleaseRoutes(
  service: ComputerControlService,
) {
  const routes = new Hono();
  routes.post("/computer-control/releases/check", (c) =>
    c.json(service.requestRelease("check"), 202),
  );
  routes.post("/computer-control/releases/update", (c) =>
    c.json(service.requestRelease("update"), 202),
  );
  routes.put("/computer-control/releases/enabled", async (c) => {
    const value = z
      .object({ enabled: z.boolean() })
      .strict()
      .safeParse(await c.req.json());
    if (!value.success) return c.json({ error: "Invalid enable setting" }, 400);
    return c.json(await service.setManagedEnabled(value.data.enabled), 202);
  });
  routes.put("/computer-control/releases/automatic", async (c) => {
    const value = z
      .object({ autoUpdate: z.boolean() })
      .strict()
      .safeParse(await c.req.json());
    if (!value.success) return c.json({ error: "Invalid update setting" }, 400);
    return c.json(await service.setAutoUpdate(value.data.autoUpdate));
  });
  return routes;
}
