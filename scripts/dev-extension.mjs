/** Opt-in extension build owner. One debounced build, no backend polling. */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { watch } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_STAMP = "YA_DEV_WORKER_STAMP_PLACEHOLDER";

/** Exactly one owner per checkout output, shared by different dev profiles. */
async function acquireOutput(cache) {
  const path = join(cache, "owner.json");
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, "wx");
      await file.writeFile(JSON.stringify({ pid: process.pid, token }));
      await file.close();
      return async () => {
        const owner = JSON.parse(
          await readFile(path, "utf8").catch(() => "null"),
        );
        if (owner?.token === token) await rm(path, { force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = JSON.parse(
        await readFile(path, "utf8").catch(() => "null"),
      );
      if (!Number.isInteger(owner?.pid) || owner.pid <= 0)
        throw new Error(`Extension build owner is unknown: ${path}`);
      try {
        process.kill(owner.pid, 0);
      } catch (probe) {
        if (probe.code === "ESRCH" && attempt === 0) {
          await rm(path);
          continue;
        }
        if (probe.code !== "ESRCH" && probe.code !== "EPERM") throw probe;
      }
      throw new Error(
        `Extension development already has an owner (PID ${owner.pid})`,
      );
    }
  }
  throw new Error("Could not acquire extension build ownership");
}

/** Dependency assets first, entrypoints next, successful generation marker last. */
export async function publishExtensionBuild(stage, output, metadata) {
  await mkdir(output, { recursive: true });
  let previous;
  try {
    previous = JSON.parse(
      await readFile(join(output, "dev-build.json"), "utf8"),
    );
  } catch {
    /* first build */
  }
  await cp(join(stage, "assets"), join(output, "assets"), { recursive: true });
  for (const entry of await readdir(stage)) {
    if (
      entry === "assets" ||
      entry === "dev-build.json" ||
      entry === "manifest.json"
    )
      continue;
    await cp(join(stage, entry), join(output, entry), { recursive: true });
  }
  await cp(join(stage, "manifest.json"), join(output, "manifest.json"));
  const assets = await readdir(join(stage, "assets"));
  const keep = new Set([...assets, ...(previous?.assets ?? [])]);
  for (const entry of await readdir(join(output, "assets"))) {
    if (!keep.has(entry))
      await rm(join(output, "assets", entry), { recursive: true, force: true });
  }
  const temporary = join(output, ".dev-build-pending.json");
  await writeFile(temporary, `${JSON.stringify({ ...metadata, assets })}\n`);
  await rename(temporary, join(output, "dev-build.json"));
}

export async function startExtensionDevelopment({
  projectRoot = root,
  build,
  publish,
  log = console.log,
  watchChanges = true,
  output: requestedOutput,
} = {}) {
  const clientRoot = join(projectRoot, "packages/client");
  const defaultOutput = join(
    projectRoot,
    "packages/browser-extension/dist-dev",
  );
  const output = requestedOutput ? resolve(requestedOutput) : defaultOutput;
  const cache = join(
    projectRoot,
    "node_modules/.cache/ya-extension-dev",
    ...(output !== defaultOutput ? [hash(output).slice(0, 12)] : []),
  );
  await mkdir(cache, { recursive: true });
  let stopped = false;
  let dirty = false;
  let running;
  let timer;
  let child;
  const watchers = [];
  const require = createRequire(join(clientRoot, "package.json"));
  const vite = build
    ? null
    : join(dirname(require.resolve("vite/package.json")), "bin/vite.js");
  const command = (script, args, env) =>
    new Promise((done, reject) => {
      child = spawn(process.execPath, [script, ...args], {
        cwd: clientRoot,
        env,
        stdio: "inherit",
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        child = undefined;
        code === 0
          ? done()
          : reject(new Error(`Extension build exited (${code ?? signal})`));
      });
    });
  const buildStage =
    build ??
    (async (stage, generation) => {
      const env = {
        ...process.env,
        YEP_EXTENSION_OUT_DIR: stage,
        YEP_EXTENSION_DEV_BUILD_ID: generation,
        YEP_EXTENSION_DEV_WORKER_STAMP: WORKER_STAMP,
      };
      await command(
        vite,
        ["build", "--config", "vite.config.extension.ts"],
        env,
      );
      if (stopped) throw new Error("Extension development stopped");
      await command(
        vite,
        ["build", "--config", "vite.config.extension-worker.ts"],
        env,
      );
      if (stopped) throw new Error("Extension development stopped");
      await command(
        join(projectRoot, "packages/browser-extension/scripts/assemble.mjs"),
        [],
        env,
      );
      const worker = await readFile(join(stage, "background.js"), "utf8");
      if (!worker.includes(WORKER_STAMP))
        throw new Error("Missing development worker stamp");
      const workerHash = hash(worker);
      await writeFile(
        join(stage, "background.js"),
        worker.replaceAll(WORKER_STAMP, workerHash),
      );
      const manifest = JSON.parse(
        await readFile(join(stage, "manifest.json"), "utf8"),
      );
      return {
        generation,
        builtAt: new Date().toISOString(),
        workerHash,
        manifest: canonicalJson(manifest),
      };
    });
  const drain = () => {
    if (stopped || running) return running;
    running = (async () => {
      while (dirty && !stopped) {
        dirty = false;
        let stage;
        try {
          stage = await mkdtemp(join(cache, "build-"));
          const generation = randomUUID();
          log("[ExtensionDev] Building extension...");
          const metadata = await buildStage(stage, generation);
          if (!stopped && !dirty) {
            await (publish ?? publishExtensionBuild)(stage, output, metadata);
            log(`[ExtensionDev] Ready: ${output} (${generation.slice(0, 8)})`);
          }
        } catch (error) {
          if (!stopped)
            log(
              `[ExtensionDev] Build failed; keeping previous build: ${error.message}`,
            );
        } finally {
          if (stage) await rm(stage, { recursive: true, force: true });
        }
      }
    })().finally(() => {
      running = undefined;
      if (dirty && !stopped) void drain();
    });
    return running;
  };
  const changed = () => {
    if (stopped) return;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void drain();
    }, 300);
  };
  let release;
  const close = async () => {
    stopped = true;
    dirty = false;
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    child?.kill("SIGTERM");
    try {
      await running;
    } finally {
      await release?.();
    }
  };
  try {
    release = await acquireOutput(cache);
    if (watchChanges) {
      // Fixed source roots only, with a pre-acquisition native watcher ceiling.
      const recursiveRoots = [
        "packages/client/src",
        "packages/shared/src",
        "packages/browser-extension/src",
      ];
      let directories = 0;
      async function countDirectories(path) {
        if (++directories > 2048)
          throw new Error("Extension watch exceeds 2048 source directories");
        for (const entry of await readdir(path, { withFileTypes: true }))
          if (entry.isDirectory())
            await countDirectories(join(path, entry.name));
      }
      for (const path of recursiveRoots)
        await countDirectories(join(projectRoot, path));
      const addWatch = (path, recursive, filter = () => true) => {
        const watcher = watch(
          join(projectRoot, path),
          { recursive },
          (_event, name) => {
            if (!name || filter(String(name))) changed();
          },
        );
        watcher.on("error", (error) => {
          log(`[ExtensionDev] Watch stopped: ${error.message}`);
          void close();
        });
        watchers.push(watcher);
      };
      for (const path of recursiveRoots) addWatch(path, true);
      addWatch("packages/client", false, (name) =>
        /^(vite.*\.ts|.*\.html|package\.json|tsconfig.*\.json)$/.test(name),
      );
      addWatch(
        "packages/browser-extension",
        false,
        (name) => name === "package.json",
      );
      addWatch(
        "packages/browser-extension/scripts",
        false,
        (name) => name === "assemble.mjs",
      );
      addWatch(
        "docs/distribution/chrome-extension",
        false,
        (name) => name === "identity.json",
      );
      addWatch("", false, (name) =>
        ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"].includes(
          name,
        ),
      );
    }
    dirty = true;
    void drain();
    return {
      output,
      rebuild: changed,
      settled: async () => {
        while (running || dirty) {
          if (dirty && !running) {
            clearTimeout(timer);
            drain();
          }
          await running;
        }
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const owner = await startExtensionDevelopment({
    output: process.env.YEP_EXTENSION_DEV_DIR,
  });
  const stop = async () => {
    await owner.close();
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
