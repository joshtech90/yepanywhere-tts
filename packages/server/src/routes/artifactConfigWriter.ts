import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ArtifactServer } from "../artifacts/ArtifactServer.js";
import {
  validateArtifactConfig,
  type ArtifactConfig,
} from "../artifacts/config.js";
import { configuredVhostNames } from "../artifacts/vhosts.js";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";

export interface ArtifactConfigWriterOptions {
  server: ArtifactServer;
  settings?: ServerSettingsService;
  locked: boolean;
}

/**
 * Validate, apply and persist a whole artifact configuration, one change at a
 * time across every route that writes it, so two claims of one vhost name
 * cannot both succeed. `apply` returns an error response, or null once the
 * change is live and saved.
 */
export function createArtifactConfigWriter(
  options: ArtifactConfigWriterOptions,
) {
  let updating = false;
  async function apply(
    c: Context,
    input: unknown,
    afterSave?: (config: ArtifactConfig) => Promise<void>,
  ): Promise<Response | null> {
    if (options.locked || !options.settings)
      return c.json(
        { error: "Artifact configuration is controlled at launch" },
        409,
      );
    if (updating)
      return c.json({ error: "Artifact configuration is being updated" }, 409);
    let config: ArtifactConfig;
    try {
      config = validateArtifactConfig(
        typeof input === "function" ? input(options.server.config) : input,
        options.server.config.expiryDays,
        options.server.config,
      );
      const requestHost = new URL(
        `http://${c.req.header("Host") ?? new URL(c.req.url).host}`,
      ).hostname;
      const clientBase = options.settings.getSetting("yaClientBaseUrl");
      const yaHosts = [
        requestHost,
        clientBase ? new URL(clientBase).hostname : undefined,
      ];
      if (
        [config.localOrigin, config.publicOrigin].some(
          (origin) => origin && yaHosts.includes(new URL(origin).hostname),
        )
      ) {
        throw new Error("Artifacts require a different hostname from YA");
      }
      // A vhost may not shadow YA's own client or artifact host.
      const taken = [
        ...yaHosts,
        ...[config.localOrigin, config.publicOrigin].map(
          (origin) => origin && new URL(origin).hostname,
        ),
      ];
      const shadowed = config.vhostPublicRoot
        ? configuredVhostNames(config).find((name) =>
            taken.includes(`${name}.${config.vhostPublicRoot}`),
          )
        : undefined;
      if (shadowed)
        throw new Error(`The name "${shadowed}" is one of YA's own hosts`);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid artifact configuration",
        },
        400,
      );
    }
    updating = true;
    const previous = options.server.config;
    try {
      try {
        await options.server.configure(config);
      } catch (error) {
        // A project app address holding the name is a lost race, not bad input.
        if (
          error instanceof Error &&
          /reserved by a project/.test(error.message)
        )
          return c.json({ error: error.message }, 409);
        throw error;
      }
      try {
        await options.settings.updateSettings({ artifactViewer: config });
      } catch (error) {
        await options.server.configure(previous);
        throw error;
      }
      await afterSave?.(options.server.config);
      return null;
    } finally {
      updating = false;
    }
  }
  return { apply };
}

export type ArtifactConfigWriter = ReturnType<
  typeof createArtifactConfigWriter
>;
