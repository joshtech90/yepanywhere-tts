import { createServer } from "node:http";
import { join } from "node:path";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import type { UrlProjectId } from "@yep-anywhere/shared";
import { ArtifactServer } from "../../src/artifacts/ArtifactServer.js";
import { createLocalResourcePathPolicy } from "../../src/routes/local-resource-policy.js";
import { PublicShareService } from "../../src/services/PublicShareService.js";

const [directory, proxyPort, upstreamPort] = process.argv.slice(2);
if (!directory || !proxyPort || !upstreamPort)
  throw new Error("Missing fixture arguments");
const origin = `http://artifacts.localhost:${proxyPort}`;
const artifacts = new ArtifactServer(
  {
    port: Number(proxyPort),
    localOrigin: origin,
    vhosts: [
      { name: "plan", port: Number(upstreamPort) },
      { name: "public", port: Number(upstreamPort), public: true },
    ],
  },
  createLocalResourcePathPolicy({ allowedPaths: [directory] }),
  {
    stateDir: join(directory, "artifacts"),
  },
);
const shares = new PublicShareService({ dataDir: directory });
await Promise.all([artifacts.ready, shares.initialize()]);
const app = new Hono();
app.use(
  "*",
  async (c, next) => (await artifacts.dispatchHost(c.req.raw)) ?? next(),
);
app.post("/test/issue", async (c) => {
  const grant = await artifacts.createGrant(
    join(directory, "index.html"),
    "local",
  );
  const share = await shares.createShare({
    mode: "live",
    source: { projectId: "test" as UrlProjectId, sessionId: "test" },
  });
  return c.json({
    grant,
    share: { secret: share.secret, id: share.record.shareId },
    app: `http://plan.localhost:${proxyPort}/?ya_access=${artifacts.vhostAccess.token(artifacts.config.vhosts![0]!)}`,
  });
});
app.post("/test/revoke", async (c) => {
  const { grant, share } = await c.req.json<{ grant: string; share: string }>();
  await artifacts.revoke(grant);
  await shares.revokeShare(share);
  await artifacts.vhostAccess.rotate(artifacts.config.vhosts![0]!);
  return c.json({ revoked: true });
});
app.get("/share/:secret", (c) =>
  c.text(
    "Shared session",
    shares.getRecordBySecret(c.req.param("secret")) ? 200 : 404,
  ),
);
const listener = createServer(getRequestListener(app.fetch));
listener.listen(Number(proxyPort), "127.0.0.1", () =>
  process.send?.({ ready: true }),
);
process.on("SIGTERM", async () => {
  listener.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  await artifacts.close();
  process.exit(0);
});
