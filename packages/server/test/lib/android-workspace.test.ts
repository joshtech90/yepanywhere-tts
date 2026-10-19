import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertAndroidWorkspaceAvailable } from "../../src/lib/android-workspace.js";

afterEach(() => vi.unstubAllEnvs());

describe("Android native workspace admission", () => {
  it("leaves ordinary desktop and private Android directories alone", async () => {
    vi.stubEnv("YEP_ANDROID_SAF_SOCKET", undefined);
    await assertAndroidWorkspaceAvailable("/workspaces/desktop");
    vi.stubEnv("YEP_ANDROID_SAF_SOCKET", "absent");
    await assertAndroidWorkspaceAvailable("/home/user/project");
    await assertAndroidWorkspaceAvailable("/sdcard-other/project");
    await assertAndroidWorkspaceAvailable("/storage-other/project");
  });

  it.skipIf(process.platform !== "linux").each([
    {
      cwd: "/workspaces/docs/project",
      request: { op: "check", root: "docs" },
      expectedPath: "/workspaces/docs",
    },
    {
      cwd: "/sdcard/Documents/project",
      request: { op: "check-shared" },
      expectedPath: "/sdcard",
    },
    {
      cwd: "/storage/1234-ABCD/Documents/project",
      request: { op: "check-volume", volume: "1234-ABCD" },
      expectedPath: "/storage/1234-ABCD",
    },
  ])(
    "rechecks $cwd for each launch and refuses subsequently revoked access",
    async ({ cwd, request, expectedPath }) => {
      const endpoint = `ya-test-${randomBytes(8).toString("hex")}`;
      vi.stubEnv("YEP_ANDROID_SAF_SOCKET", endpoint);
      let requests = 0;
      const server = createServer({ allowHalfOpen: true }, (socket) => {
        const parts: Buffer[] = [];
        socket.on("data", (chunk) => parts.push(chunk));
        socket.on("end", () => {
          const bytes = Buffer.concat(parts);
          expect(bytes.readUInt32BE()).toBe(bytes.length - 4);
          expect(JSON.parse(bytes.subarray(4).toString())).toEqual(request);
          const reply = Buffer.from(
            JSON.stringify(
              ++requests === 1
                ? { ok: true, result: { path: expectedPath } }
                : { ok: false, message: "Folder permission unavailable" },
            ),
          );
          const header = Buffer.alloc(4);
          header.writeUInt32BE(reply.length);
          socket.write(header.subarray(0, 2));
          socket.write(Buffer.concat([header.subarray(2), reply]));
          socket.end();
        });
      });
      await new Promise<void>((accept) =>
        server.listen(`\0${endpoint}`, accept),
      );
      try {
        await assertAndroidWorkspaceAvailable(cwd);
        await expect(assertAndroidWorkspaceAvailable(cwd)).rejects.toThrow(
          "Folder permission unavailable",
        );
        expect(requests).toBe(2);
      } finally {
        await new Promise<void>((accept, reject) =>
          server.close((error) => (error ? reject(error) : accept())),
        );
      }
    },
  );
});
