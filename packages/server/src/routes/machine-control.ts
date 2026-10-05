import { RETIRED_COMPUTER_CONTROL_ERROR } from "../machine-control/legacy-retirement.js";
import { Hono } from "hono";
import {
  defaultInstallation,
  verifyInstalledMachineControl,
} from "../machine-control/installation.js";
import type { MachineControlDependencies } from "../sdk/providers/machine-control.js";

export function supportsInstalledMachineControl(platform = process.platform) {
  return ["darwin", "win32", "linux"].includes(platform);
}

/** Read-only installation readiness. Never starts a resident or obtains access. */
export function createMachineControlRoutes(
  dependencies: MachineControlDependencies = {},
) {
  const routes = new Hono();
  // Old clients get an explicit refusal, never a replacement opt-in.
  routes.all("/computer-control", (c) =>
    c.json({ error: RETIRED_COMPUTER_CONTROL_ERROR }, 410),
  );
  routes.all("/computer-control/*", (c) =>
    c.json({ error: RETIRED_COMPUTER_CONTROL_ERROR }, 410),
  );
  routes.get("/machine-control", async (c) => {
    const platform = dependencies.platform ?? process.platform;
    if (!supportsInstalledMachineControl(platform as NodeJS.Platform))
      return c.json({ available: false, reason: "unsupported-host" });
    const environment = dependencies.environment ?? process.env;
    try {
      const installation = await (
        dependencies.verify ?? verifyInstalledMachineControl
      )(
        environment.YEP_MC_APP ?? defaultInstallation(platform, environment),
        platform === "darwin"
          ? environment.YEP_MC_TEAM_ID
          : environment.YEP_MC_PUBLISHER,
        platform as NodeJS.Platform,
      );
      return c.json({ available: true, version: installation.version });
    } catch {
      // Optional absence and verification failures disclose no private paths.
      return c.json({ available: false, reason: "installation-unavailable" });
    }
  });
  return routes;
}
