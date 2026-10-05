import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type FileViewSearchResult,
  toUrlProjectId,
} from "@yep-anywhere/shared";
import { afterEach, describe, expect, it } from "vitest";
import { runGit } from "../../src/git/gitExec.js";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import { createProjectFileViewSearchRoutes } from "../../src/routes/project-file-view-search.js";
import { ProjectFileCompletion } from "../../src/services/projectFileCompletion.js";
import {
  type FileViewHostAccess,
  type FileViewSearchRequest,
  searchFileView,
} from "../../src/services/projectFileViewSearch.js";

const temporary: string[] = [];
const services: ProjectFileCompletion[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function fixture(files: {
  tracked?: string[];
  untracked?: string[];
  ignored?: string[];
  gitignore?: string;
}) {
  const root = await mkdtemp(join(tmpdir(), "ya-file-view-"));
  temporary.push(root);
  const project = join(root, "project");
  await mkdir(project);
  await runGit(project, ["init", "--template="]);
  const all = [
    ...(files.tracked ?? []),
    ...(files.untracked ?? []),
    ...(files.ignored ?? []),
  ];
  for (const path of all) {
    await mkdir(dirname(join(project, path)), { recursive: true });
    await writeFile(join(project, path), "fixture");
  }
  if (files.gitignore)
    await writeFile(join(project, ".gitignore"), files.gitignore);
  if (files.tracked?.length) await runGit(project, ["add", ...files.tracked]);
  const service = new ProjectFileCompletion(join(root, "data"));
  services.push(service);
  return { root, project, service };
}

/** Search until the untracked inventory has settled. */
async function settled(
  service: ProjectFileCompletion,
  project: string,
  request: Partial<FileViewSearchRequest> & { parts: string[] },
  access: FileViewHostAccess | null = null,
  home?: string,
): Promise<FileViewSearchResult> {
  const full = { recent: [], includeIgnored: false, ...request };
  let result = await searchFileView(service, project, full, access, home);
  for (let i = 0; result.pending && i < 200; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    result = await searchFileView(service, project, full, access, home);
  }
  expect(result.pending).toBe(false);
  return result;
}

const paths = (result: FileViewSearchResult) =>
  result.entries.map((entry) => `${entry.tier}:${entry.path}`);

const allowAll: FileViewHostAccess = {
  resolveAllowedFilePath: async () => ({ ok: true }),
  resolveAllowedDirectory: async () => ({ ok: true }),
};

describe("searchFileView", () => {
  it("ranks tracked matches first and keeps untracked ones reachable", async () => {
    const { project, service } = await fixture({
      tracked: ["src/report/table.ts", "docs/report-table.md"],
      untracked: ["src/report/table-new.ts"],
    });
    expect(
      paths(await settled(service, project, { parts: ["report", "table"] })),
    ).toEqual([
      "tracked:src/report/table.ts",
      "tracked:docs/report-table.md",
      "untracked:src/report/table-new.ts",
    ]);
  });

  it("requires parts in order and prefers a basename hit", async () => {
    const { project, service } = await fixture({
      tracked: ["alpha/beta.ts", "beta/alpha.ts", "beta/x/alpha-long-name.ts"],
    });
    expect(
      paths(await settled(service, project, { parts: ["beta", "alpha"] })),
    ).toEqual(["tracked:beta/alpha.ts", "tracked:beta/x/alpha-long-name.ts"]);
    // Spans locate each part in order, and a root anchor as its own span.
    expect(
      (await settled(service, project, { parts: ["Beta", "ALP"] })).entries,
    ).toEqual([]);
    expect(
      (await settled(service, project, { parts: ["beta/x", "alp"] }))
        .entries[0],
    ).toEqual({
      path: "beta/x/alpha-long-name.ts",
      tier: "tracked",
      spans: [
        [0, 6],
        [7, 10],
      ],
    });
    // Lowercase parts fold case; an uppercase letter makes matching exact.
    expect(paths(await settled(service, project, { parts: ["BETA"] }))).toEqual(
      [],
    );
  });

  it("anchors a leading root prefix instead of searching it anywhere", async () => {
    const { project, service } = await fixture({
      tracked: [
        "packages/client/src/view.ts",
        "vendor/packages/client/view.ts",
      ],
    });
    expect(
      paths(
        await settled(service, project, { parts: ["packages/cl", "view"] }),
      ),
    ).toEqual(["tracked:packages/client/src/view.ts"]);
    // Not a root prefix, so it is an ordinary ordered needle.
    expect(
      paths(await settled(service, project, { parts: ["ges/client", "view"] })),
    ).toEqual([
      "tracked:packages/client/src/view.ts",
      "tracked:vendor/packages/client/view.ts",
    ]);
  });

  it("opens an exact ignored path and scans ignored files only on submit", async () => {
    const { project, service } = await fixture({
      tracked: ["src/index.ts"],
      ignored: ["runs/2026/out.json", "node_modules/pkg/out.json"],
      gitignore: "runs/\nnode_modules/\n",
    });
    expect(
      paths(await settled(service, project, { parts: ["runs/2026/out.json"] })),
    ).toEqual(["path:runs/2026/out.json"]);
    expect(
      paths(await settled(service, project, { parts: ["out.json"] })),
    ).toEqual([]);
    expect(
      paths(
        await settled(service, project, {
          parts: ["out.json"],
          includeIgnored: true,
        }),
      ).sort(),
    ).toEqual([
      "ignored:node_modules/pkg/out.json",
      "ignored:runs/2026/out.json",
    ]);
  });

  it("anchors absolute and home paths that fall inside the project", async () => {
    const { root, project, service } = await fixture({
      tracked: ["src/a/index.ts", "src/b/index.ts"],
    });
    expect(
      paths(
        await settled(service, project, {
          parts: [join(project, "src/a"), "index"],
        }),
      ),
    ).toEqual(["tracked:src/a/index.ts"]);
    expect(
      paths(
        await settled(
          service,
          project,
          { parts: ["~/project/src/b/index.ts"] },
          null,
          root,
        ),
      ),
    ).toEqual(["path:src/b/index.ts"]);
  });

  it("maps a missing absolute path from another checkout onto this project", async () => {
    const { project, service } = await fixture({
      tracked: ["packages/server/src/app.ts", "packages/server/src/main.ts"],
    });
    expect(
      paths(
        await settled(service, project, {
          parts: ["/elsewhere/other-checkout/packages/server/src/app.ts"],
        }),
      ),
    ).toEqual(["path:packages/server/src/app.ts"]);
    expect(
      paths(
        await settled(service, project, {
          parts: ["/elsewhere/other-checkout/packages/server", "main"],
        }),
      ),
    ).toEqual(["tracked:packages/server/src/main.ts"]);
  });

  it("searches an existing outside directory only with host access", async () => {
    const { root, project, service } = await fixture({
      tracked: ["src/index.ts"],
    });
    const outside = join(root, "notes");
    await mkdir(join(outside, "2026"), { recursive: true });
    await writeFile(join(outside, "2026", "plan.md"), "fixture");
    await expect(
      settled(service, project, { parts: [outside, "plan"] }),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      paths(
        await settled(service, project, { parts: [outside, "plan"] }, allowAll),
      ),
    ).toEqual([`outside:${join(outside, "2026", "plan.md")}`]);
    expect(
      paths(
        await settled(
          service,
          project,
          { parts: [join(outside, "2026", "plan.md")] },
          allowAll,
        ),
      ),
    ).toEqual([`path:${join(outside, "2026", "plan.md")}`]);
  });
});

describe("file-view-search route", () => {
  it("serves parts and refuses malformed queries", async () => {
    const { root, project, service } = await fixture({
      tracked: ["src/index.ts"],
    });
    const routes = createProjectFileViewSearchRoutes({
      scanner: {
        getProject: async () => ({ path: project }),
      } as unknown as ProjectScanner,
      service,
      allowedPaths: [root],
    });
    const id = toUrlProjectId(project);
    const response = await routes.request(
      `/${id}/file-view-search?part=src&part=index`,
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as FileViewSearchResult).entries).toEqual([
      {
        path: "src/index.ts",
        tier: "tracked",
        spans: [
          [0, 3],
          [4, 9],
        ],
      },
    ]);
    expect((await routes.request(`/${id}/file-view-search?part=`)).status).toBe(
      400,
    );
    expect(
      (
        await routes.request(
          `/${id}/file-view-search?${Array.from({ length: 17 }, () => "part=x").join("&")}`,
        )
      ).status,
    ).toBe(400);
  });
});
