import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createSocketServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type InlineConfig } from "vite";

/**
 * Vite discards a configured port of 0: `startServer` tests it with `!port`,
 * so the "let the OS pick" request silently becomes the 5173 default. Fixture
 * servers that inherit `strictPort: true` from `vite.config.ts` then fail
 * outright once anything else in the run holds 5173. Reserve a real free port
 * ourselves instead, and leave `strictPort` off so a lost race walks forward.
 */
async function reserveEphemeralPort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = createSocketServer();
    socket.on("error", reject);
    socket.listen(0, host, () => {
      const address = socket.address();
      if (!address || typeof address === "string") {
        socket.close();
        reject(new Error("Could not reserve an ephemeral port"));
        return;
      }
      const { port } = address;
      socket.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

/** Concurrent fixture servers must not invalidate each other's optimized modules. */
export async function createTestViteServer(config: InlineConfig) {
  const requestedPort = config.server?.port;
  const serverOverrides =
    requestedPort && requestedPort > 0
      ? config.server
      : {
          ...config.server,
          port: await reserveEphemeralPort(
            typeof config.server?.host === "string"
              ? config.server.host
              : "127.0.0.1",
          ),
          strictPort: false,
        };
  const directory = await mkdtemp(join(tmpdir(), "ya-e2e-vite-"));
  // Keep optimized dependencies under node_modules so React/Babel does not
  // process them again as application source.
  const cacheDir = join(directory, "node_modules", ".vite");
  try {
    const server = await createServer({
      ...config,
      server: serverOverrides,
      cacheDir,
      define: {
        "import.meta.env.VITE_DISABLE_ONBOARDING": JSON.stringify("true"),
        "import.meta.env.VITE_DISABLE_CLI_UPDATE_NOTIFICATIONS":
          JSON.stringify("true"),
        ...config.define,
      },
    });
    const close = server.close.bind(server);
    server.close = async () => {
      try {
        await close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    };
    return server;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
