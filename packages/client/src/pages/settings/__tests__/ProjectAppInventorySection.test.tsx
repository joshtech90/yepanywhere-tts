import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { ProjectAppInventorySection } from "../ProjectAppInventorySection";
import { api } from "../../../api/client";

const mock = vi.hoisted(() => ({
  version: "0.9.2",
  deletion: false,
  fetch: vi.fn(),
}));
vi.mock("../../../hooks/useVersion", () => ({
  useVersion: () => ({
    version: {
      current: mock.version,
      optionalCapabilityBits: mock.deletion ? [[3, 16384]] : undefined,
    },
  }),
}));
vi.mock("../../../api/sourceApiFetch", () => ({ fetchJSON: mock.fetch }));
afterEach(() => {
  cleanup();
  mock.fetch.mockReset();
  mock.deletion = false;
  vi.restoreAllMocks();
});

it("can release a known project's retained address while vhost hosting is disabled", async () => {
  mock.version = "0.9.4";
  const reservation = {
    projectId: "test",
    name: "canvas",
    namespace: "old.example",
    owner: "superuser",
  };
  let reservations = [reservation];
  mock.fetch.mockImplementation(async (path: string) => {
    if (path === "/projects/test/app")
      return { state: "ready", removedFrom: [] };
    if (path === "/projects/test/app/address")
      return { enabled: false, reservations: [] };
    if (path === "/project-apps/address/release") {
      reservations = [];
      return { released: true };
    }
    return {
      projects: [
        {
          projectId: "test",
          name: "Canvas",
          path: "/project",
          info: { state: "ready" },
        },
      ],
      reservations,
    };
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(
    <I18nProvider>
      <ProjectAppInventorySection />
    </I18nProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Canvas" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Release address" }),
  );
  await waitFor(() =>
    expect(screen.queryByText("canvas.old.example")).toBeNull(),
  );
  expect(mock.fetch).toHaveBeenCalledWith("/project-apps/address/release", {
    method: "POST",
    body: JSON.stringify({ projectId: "test", namespace: "old.example" }),
  });
});

it("shows and sorts project folders and sorts retained addresses with live rows", async () => {
  mock.version = "0.9.4";
  mock.fetch.mockResolvedValue({
    projects: [
      {
        projectId: "one",
        name: "First",
        path: "/home/me/z/project",
        info: { state: "ready" },
      },
      {
        projectId: "two",
        name: "Second",
        path: "/home/me/a/project",
        info: { state: "ready" },
      },
    ],
    reservations: [
      {
        projectId: "one",
        name: "zebra",
        namespace: "apps.test",
        owner: "superuser",
      },
      {
        projectId: "two",
        name: "beta",
        namespace: "apps.test",
        owner: "superuser",
      },
      {
        projectId: "gone",
        name: "alpha",
        namespace: "apps.test",
        owner: "superuser",
      },
    ],
  });
  render(
    <I18nProvider>
      <ProjectAppInventorySection />
    </I18nProvider>,
  );
  const table = within(
    await screen.findByRole("table", { name: "Project apps" }),
  );
  const rows = () =>
    table
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent);
  expect(table.getByTitle("/home/me/z/project")).toBeTruthy();
  fireEvent.click(table.getByRole("button", { name: "Project folder" }));
  expect(rows()[1]).toContain("Second");
  fireEvent.click(table.getByRole("button", { name: "Project folder" }));
  expect(rows()[0]).toContain("First");
  fireEvent.click(table.getByRole("button", { name: "Domain" }));
  expect(rows()[0]).toContain("alpha.apps.test");
  expect(rows()[2]).toContain("zebra.apps.test");
  expect(mock.fetch).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "confirms and separates app deletion from project deletion (%s)",
  async (removeProject) => {
    mock.version = "0.9.4";
    mock.deletion = true;
    let deleted = false;
    mock.fetch.mockImplementation(
      async (path: string, options?: RequestInit) => {
        if (options?.method === "DELETE") {
          deleted = true;
          return { deleted: true };
        }
        if (path === "/projects/test/app")
          return { state: "ready", removedFrom: [] };
        if (path === "/projects/test/app/address")
          return { enabled: false, reservations: [] };
        return {
          projects: deleted
            ? []
            : [
                {
                  projectId: "test",
                  name: "Canvas",
                  path: "/project",
                  info: { state: "ready" },
                },
              ],
          reservations: [],
        };
      },
    );
    const deleteProject = vi.spyOn(api, "deleteProject").mockResolvedValue({
      removed: true,
      projectId: "test",
      path: "/project",
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <I18nProvider>
        <ProjectAppInventorySection />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Canvas" }));
    const button = screen.getByRole("button", {
      name: removeProject ? "Delete project" : "Delete app",
    });
    fireEvent.click(button);
    expect(mock.fetch).not.toHaveBeenCalledWith("/projects/test/app", {
      method: "DELETE",
    });
    confirm.mockReturnValue(true);
    fireEvent.click(button);
    await waitFor(() =>
      expect(mock.fetch).toHaveBeenCalledWith("/projects/test/app", {
        method: "DELETE",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Canvas" })).toBeNull(),
    );
    if (removeProject) expect(deleteProject).toHaveBeenCalledWith("test");
    else expect(deleteProject).not.toHaveBeenCalled();
  },
);

it("keeps cleanup failures visible after refreshing partially changed inventory", async () => {
  mock.version = "0.9.4";
  mock.deletion = true;
  let deleted = false;
  mock.fetch.mockImplementation(async (path: string, options?: RequestInit) => {
    if (options?.method === "DELETE") {
      deleted = true;
      return { deleted: true };
    }
    if (path === "/projects/test/app")
      return { state: "ready", removedFrom: [] };
    if (path === "/projects/test/app/address")
      return { enabled: false, reservations: [] };
    return {
      projects: deleted
        ? []
        : [
            {
              projectId: "test",
              name: "Canvas",
              path: "/project",
              info: { state: "ready" },
            },
          ],
      reservations: [],
    };
  });
  vi.spyOn(api, "deleteProject").mockRejectedValue(
    new Error("Project removal failed"),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(
    <I18nProvider>
      <ProjectAppInventorySection />
    </I18nProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Canvas" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Canvas" })).toBeNull(),
  );
  expect(screen.getByRole("alert").textContent).toBe("Project removal failed");
});

it.each(["0.9.0", "0.9.1", "0.9.2"])(
  "keeps %s servers free of inventory requests",
  (version) => {
    mock.version = version;
    render(
      <I18nProvider>
        <ProjectAppInventorySection />
      </I18nProvider>,
    );
    expect(
      screen.getByText(/Update the server to list project apps here/),
    ).toBeTruthy();
    expect(mock.fetch).not.toHaveBeenCalled();
  },
);
