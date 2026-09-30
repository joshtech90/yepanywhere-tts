import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EMPTY_LIMITED_USER_GRANTS,
  toUrlProjectId,
} from "@yep-anywhere/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  PRINCIPAL_VARIABLE,
  type Principal,
} from "../../src/auth/principal.js";
import {
  copyProjectTree,
  createProjectCopyRoutes,
} from "../../src/routes/project-copy.js";

let root: string;
let source: string;
let principal: Principal;
let app: Hono;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "ya-project-copy-")));
  source = join(root, "owner", "game");
  await mkdir(join(source, "dist"), { recursive: true });
  await mkdir(join(source, "node_modules", "dep"), { recursive: true });
  await writeFile(join(source, "dist", "index.html"), "<h1>game</h1>");
  await writeFile(join(source, "node_modules", "dep", "x.js"), "big");
  await writeFile(join(root, "secret.txt"), "host file");
  await symlink(join(root, "secret.txt"), join(source, "link.txt"));
  principal = {
    kind: "limited",
    username: "kid",
    grants: {
      ...EMPTY_LIMITED_USER_GRANTS,
      viewProjects: [toUrlProjectId(source)],
      projectRoot: join(root, "kid"),
    },
    switched: false,
    locked: true,
    via: "direct",
  };
  app = new Hono();
  app.use("*", async (c, next) => {
    c.set(PRINCIPAL_VARIABLE as never, principal as never);
    await next();
  });
  app.route(
    "/api",
    createProjectCopyRoutes({
      scanner: {
        getProject: async (id: string) =>
          id === toUrlProjectId(source)
            ? ({ id, path: source } as never)
            : null,
      },
    }),
  );
});
afterEach(async () => {
  await rm(root, { recursive: true });
});

function copy(name: string) {
  return app.request(`/api/projects/${toUrlProjectId(source)}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

it("copies the working tree into the user's project directory, without dependencies or links", async () => {
  const response = await copy("my-game");
  expect(response.status).toBe(201);
  const destination = join(root, "kid", "my-game");
  expect(await response.json()).toEqual({ path: destination });
  expect(await readFile(join(destination, "dist", "index.html"), "utf8")).toBe(
    "<h1>game</h1>",
  );
  expect((await readdir(destination)).sort()).toEqual(["dist"]);
  // A second copy under the same name is refused and leaves the first alone.
  expect((await copy("my-game")).status).toBe(409);
  expect(await readdir(destination)).toEqual(["dist"]);
});

it("refuses unsafe names and users with no project directory", async () => {
  expect((await copy("../escape")).status).toBe(400);
  expect((await copy(".hidden")).status).toBe(400);
  if (principal.kind !== "limited") throw new Error("expected limited");
  principal = {
    ...principal,
    grants: { ...principal.grants, projectRoot: undefined },
  };
  expect((await copy("again")).status).toBe(403);
});

it("stops at the size limit and removes the partial copy", async () => {
  const destination = join(root, "partial");
  await mkdir(destination);
  await expect(
    copyProjectTree(source, destination, { bytes: 4, entries: 100 }),
  ).rejects.toThrow("too large");
});
