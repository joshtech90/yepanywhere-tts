import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const projectServiceWorkerPath = fileURLToPath(
  new URL(
    "../packages/server/src/projects/project-service-worker.ts",
    import.meta.url,
  ),
);

/** The existing provider host owns app workers, independently of provider sessions. */
export class ProviderProjectServices {
  constructor(retainGroup, releaseGroup, terminateGroup) {
    this.retainGroup = retainGroup;
    this.releaseGroup = releaseGroup;
    this.terminateGroup = terminateGroup;
    this.appGroups = new Map();
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.closing = false;
  }

  launch() {
    if (this.failure) throw this.failure;
    if (this.child) return;
    if (this.closing) throw new Error("App owner is closing");
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--conditions", "source", projectServiceWorkerPath],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: process.env,
        detached: true,
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      },
    );
    this.child = child;
    this.exited = new Promise((resolve) => child.once("exit", resolve));
    const failed = (error) => {
      this.failure = error;
      if (this.child === child) this.child = null;
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
    child.on("error", failed);
    child.on("exit", () => {
      this.releaseGroup(child.pid);
      failed(new Error("App worker exited"));
      this.cleanup = Promise.all(
        [...this.appGroups.values()].map(async (target) => {
          await this.terminateGroup(target);
          this.releaseGroup(target.processGroupId);
          this.appGroups.delete(target.processGroupId);
        }),
      );
      void this.cleanup.catch((error) => {
        process.stderr.write(
          `[ProviderProjectServices] App cleanup failed: ${error.message}\n`,
        );
      });
    });
    child.on("message", (message) => {
      if (message.type === "processGroup") {
        this.appGroups.set(message.target.processGroupId, message.target);
        this.retainGroup(message.target.processGroupId, message.target);
        return;
      }
      if (message.type === "processGroupClosed") {
        if (this.releaseGroup(message.pid)) this.appGroups.delete(message.pid);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      if (message.type === "authorize") {
        void pending.authorize().then(
          () =>
            child.connected &&
            child.send({
              op: "authorize",
              id: message.id,
              authorizationId: message.authorizationId,
            }),
          (error) =>
            child.connected &&
            child.send({
              op: "authorize",
              id: message.id,
              authorizationId: message.authorizationId,
              error: error.message,
            }),
        );
      } else if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    });
    if (child.pid) this.retainGroup(child.pid);
  }

  request(payload, authorize = async () => {}) {
    this.launch();
    if (this.pending.size >= 128)
      throw new Error("App request limit reached (128)");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        clearTimeout(timer);
        this.pending.delete(id);
        callback(value);
      };
      const timer = setTimeout(
        () =>
          finish(
            reject,
            new Error(
              "App owner request timed out; inspect status before retrying",
            ),
          ),
        180_000,
      );
      this.pending.set(id, {
        authorize,
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error),
      });
      this.child.send({ ...payload, id }, (error) => {
        if (error) finish(reject, error);
      });
    });
  }

  async close() {
    if (!this.child) {
      this.closing = true;
      await this.cleanup;
      return;
    }
    const result = this.request({ op: "shutdown" });
    this.closing = true;
    await result;
    await this.exited;
    await this.cleanup;
  }
}
