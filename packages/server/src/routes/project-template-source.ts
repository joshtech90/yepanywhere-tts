import { Hono } from "hono";
import { PRINCIPAL_VARIABLE, type Principal } from "../auth/principal.js";
import {
  TemplateSourceService,
  TemplateSourceBusyError,
  templateSourceConfig,
} from "../projects/TemplateSourceService.js";

export function createProjectTemplateSourceRoutes(
  dataDir: string,
  service = new TemplateSourceService(dataDir),
) {
  const routes = new Hono<{
    Variables: Record<typeof PRINCIPAL_VARIABLE, Principal>;
  }>();
  routes.use("/project-template-source", async (c, next) => {
    const principal = c.get(PRINCIPAL_VARIABLE) as Principal | undefined;
    if (principal && principal.kind !== "superuser")
      return c.json({ error: "Superuser required" }, 403);
    await next();
  });
  routes.get("/project-template-source", async (c) =>
    c.json(await service.current()),
  );
  routes.put("/project-template-source", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch (error) {
      if (error instanceof SyntaxError)
        return c.json({ error: "Invalid JSON" }, 400);
      throw error;
    }
    const parsed = templateSourceConfig.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    try {
      return c.json(await service.configure(parsed.data), 202);
    } catch (error) {
      if (error instanceof TemplateSourceBusyError)
        return c.json({ error: error.message }, 409);
      throw error;
    }
  });
  return routes;
}
