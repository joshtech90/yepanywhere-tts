import {
  ACLI_COMMENTARY_MAX_BODY_BYTES,
  ACLI_COMMENTARY_MAX_TEXTS,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { renderMarkdownToHtml } from "../augments/markdown-augments.js";
import type { SafeMarkdownRenderOptions } from "../augments/safe-markdown.js";
import { tryClaimProjectPathIndex } from "../projects/projectPathIndex.js";
import type { ProjectScanner } from "../projects/scanner.js";
import { resolveProjectPath } from "./projectParam.js";

const requestSchema = z
  .object({
    texts: z.array(z.string().min(1)).min(1).max(ACLI_COMMENTARY_MAX_TEXTS),
  })
  .strict();

export function createToolCommentaryRoutes(deps: {
  scanner: ProjectScanner;
  resolveAbsoluteFilePaths?: NonNullable<
    SafeMarkdownRenderOptions["projectFileLinks"]
  >["resolveAbsoluteFilePaths"];
}): Hono {
  const routes = new Hono();
  let active = 0;
  routes.post(
    "/:projectId/tool-commentary/render",
    bodyLimit({ maxSize: ACLI_COMMENTARY_MAX_BODY_BYTES }),
    async (c) => {
      const parsed = requestSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success)
        return c.json({ error: "Invalid commentary request" }, 400);
      if (active >= 4)
        return c.json({ error: "Commentary renderer is busy" }, 503);
      active++;
      try {
        const projectPath = await resolveProjectPath(c, deps.scanner);
        if (typeof projectPath !== "string") return projectPath;
        const index = await tryClaimProjectPathIndex(projectPath);
        try {
          const options: SafeMarkdownRenderOptions = {
            localFileBasePath: projectPath,
            projectFileLinks: {
              projectId: c.req.param("projectId"),
              projectPath,
              ...(index ? { index } : {}),
              resolveAbsoluteFilePaths: deps.resolveAbsoluteFilePaths,
            },
          };
          const html: string[] = [];
          for (const text of parsed.data.texts) {
            if (c.req.raw.signal.aborted)
              return c.json({ error: "Request cancelled" }, 408);
            html.push(await renderMarkdownToHtml(text, options));
          }
          return c.json({ html });
        } finally {
          index?.release();
        }
      } finally {
        active--;
      }
    },
  );
  return routes;
}
