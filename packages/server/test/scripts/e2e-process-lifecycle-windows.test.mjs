import { execFile } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { terminateRegisteredProcess } from "../../../client/e2e/support/process-lifecycle.ts";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal()),
  execFile: vi.fn(),
}));
const platform = process.platform;
afterEach(() => {
  Object.defineProperty(process, "platform", { value: platform });
  vi.restoreAllMocks();
  vi.mocked(execFile).mockReset();
});
function windowsKill(error, exits) {
  Object.defineProperty(process, "platform", { value: "win32" });
  let alive = true;
  vi.spyOn(process, "kill").mockImplementation(() => {
    if (!alive) throw Object.assign(new Error("absent"), { code: "ESRCH" });
    return true;
  });
  vi.mocked(execFile).mockImplementation((_file, _args, _options, callback) => {
    setImmediate(() => {
      if (exits) alive = false;
      callback(error, "", "taskkill diagnostics");
    });
    return {};
  });
}
it("accepts a nonzero taskkill only after the target has exited", async () => {
  windowsKill(
    Object.assign(new Error("target exited during kill"), { code: 128 }),
    true,
  );
  await expect(
    terminateRegisteredProcess(123, "owned child"),
  ).resolves.toBeUndefined();
  expect(execFile).toHaveBeenCalledWith(
    "taskkill",
    ["/PID", "123", "/T", "/F"],
    expect.objectContaining({ timeout: 10000 }),
    expect.any(Function),
  );
});
it("propagates taskkill failure while the target remains alive", async () => {
  windowsKill(new Error("access denied"), false);
  await expect(terminateRegisteredProcess(123, "owned child")).rejects.toThrow(
    "access denied",
  );
});
it("allows exit callbacks to run during successful asynchronous cleanup", async () => {
  windowsKill(null, true);
  await expect(
    terminateRegisteredProcess(123, "owned child"),
  ).resolves.toBeUndefined();
});
