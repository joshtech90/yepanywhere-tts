import { createConnection } from "node:net";
import { resolve } from "node:path";

/** Android's native registration policy is checked before each provider launch.
 * It is not confinement of the app UID's broader shared-storage authority.
 */
export async function assertAndroidWorkspaceAvailable(
  cwd: string,
): Promise<void> {
  const endpoint = process.env.YEP_ANDROID_SAF_SOCKET;
  if (!endpoint) return;
  const path = resolve(cwd);
  const shared = path === "/sdcard" || path.startsWith("/sdcard/");
  const removable = path === "/storage" || path.startsWith("/storage/");
  if (
    !shared &&
    !removable &&
    path !== "/workspaces" &&
    !path.startsWith("/workspaces/")
  )
    return;
  const root = path.split("/")[2];
  if (!shared && !root)
    throw new Error(
      removable
        ? "Choose a removable volume beneath /storage"
        : "Choose a saved folder beneath /workspaces",
    );
  const expectedPath = shared
    ? "/sdcard"
    : removable
      ? `/storage/${root}`
      : `/workspaces/${root}`;
  const request = Buffer.from(
    JSON.stringify(
      shared
        ? { op: "check-shared" }
        : removable
          ? { op: "check-volume", volume: root }
          : { op: "check", root },
    ),
  );
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(request.length);
  await new Promise<void>((accept, reject) => {
    const socket = createConnection({ path: `\0${endpoint}` });
    let reply = Buffer.alloc(0);
    const fail = (error: Error) => {
      socket.destroy();
      reject(new Error(`Android workspace unavailable: ${error.message}`));
    };
    socket.setTimeout(5000, () =>
      fail(new Error("native folder check timed out")),
    );
    socket.once("error", fail);
    socket.once("connect", () => socket.end(Buffer.concat([prefix, request])));
    socket.on("data", (chunk: Buffer) => {
      reply = Buffer.concat([reply, chunk]);
      if (reply.length < 4) return;
      const length = reply.readUInt32BE();
      if (length > 16384) {
        fail(new Error("invalid native reply"));
        return;
      }
      if (reply.length < length + 4) return;
      try {
        const result = JSON.parse(reply.subarray(4, 4 + length).toString()) as {
          ok?: boolean;
          result?: { path?: string };
          message?: string;
        };
        if (!result.ok || result.result?.path !== expectedPath) {
          fail(new Error(result.message ?? "folder mapping refused"));
          return;
        }
        socket.destroy();
        accept();
      } catch {
        fail(new Error("invalid native reply"));
      }
    });
    socket.once("end", () => fail(new Error("native bridge disconnected")));
  });
}
