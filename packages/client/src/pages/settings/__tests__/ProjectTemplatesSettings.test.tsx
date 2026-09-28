// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  DEFAULT_PROJECT_TEMPLATE_SOURCES,
  type ProjectTemplateSourceState,
  type ProjectTemplateSourcesConfig,
} from "@yep-anywhere/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectTemplatesSettings } from "../ProjectTemplatesSettings";

/** Contract: topics/project-templates.md § Sources and inventory. */

const { fetchJSON } = vi.hoisted(() => ({ fetchJSON: vi.fn() }));

vi.mock("../../../api/sourceApiFetch", () => ({ fetchJSON }));

vi.mock("../../../hooks/useActingPrincipal", () => ({
  useActingPrincipal: () => ({
    principal: { superuser: true, switched: false },
    resolved: true,
  }),
}));

vi.mock("../../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

function stateWith(config: ProjectTemplateSourcesConfig) {
  return { config, phase: "disabled" } satisfies ProjectTemplateSourceState;
}

let saved: ProjectTemplateSourcesConfig[];

beforeEach(() => {
  saved = [];
  fetchJSON.mockImplementation(
    async (_path: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "PUT") {
        const config = JSON.parse(init.body ?? "{}");
        saved.push(config);
        return stateWith(config);
      }
      return stateWith(DEFAULT_PROJECT_TEMPLATE_SOURCES);
    },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderLoaded() {
  render(<ProjectTemplatesSettings />);
  await screen.findByText("templatesDisabled");
  const location = screen.getByLabelText("templatesRepository");
  return {
    location: location as HTMLInputElement,
    revision: screen.getByLabelText("templatesRevision") as HTMLInputElement,
  };
}

function enterLocation(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

describe("ProjectTemplatesSettings source locations", () => {
  it("reads a GitHub directory URL's ref as the revision", async () => {
    const { location, revision } = await renderLoaded();
    enterLocation(
      location,
      "https://github.com/community/templates/tree/v2/libs/canvas",
    );
    fireEvent.blur(location);
    expect(location.value).toBe(
      "https://github.com/community/templates/libs/canvas",
    );
    expect(revision.value).toBe("v2");

    fireEvent.click(screen.getByRole("button", { name: "templatesSave" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.sources[0]).toMatchObject({
      repository: "https://github.com/community/templates",
      contentPath: "libs/canvas",
      revision: "v2",
    });
  });

  it("splits a URL submitted without leaving the field", async () => {
    const { location } = await renderLoaded();
    enterLocation(location, "github.com/community/templates/tree/main");
    fireEvent.submit(location.closest("form") as HTMLFormElement);
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.sources[0]).toMatchObject({
      repository: "https://github.com/community/templates",
      contentPath: "",
      revision: "main",
    });
  });

  it("keeps a slash-containing branch already entered as the revision", async () => {
    const { location, revision } = await renderLoaded();
    fireEvent.change(revision, { target: { value: "release/2.0" } });
    enterLocation(
      location,
      "https://github.com/community/templates/tree/release/2.0/lib",
    );
    fireEvent.blur(location);
    expect(location.value).toBe("https://github.com/community/templates/lib");
    expect(revision.value).toBe("release/2.0");
  });

  it("uses the directory of a linked library.json", async () => {
    const { location, revision } = await renderLoaded();
    enterLocation(
      location,
      "https://github.com/community/templates/blob/abc123/lib/library.json",
    );
    fireEvent.blur(location);
    expect(location.value).toBe("https://github.com/community/templates/lib");
    expect(revision.value).toBe("abc123");
  });

  it("refuses a link to another file instead of saving it as a directory", async () => {
    const { location } = await renderLoaded();
    enterLocation(
      location,
      "https://github.com/community/templates/blob/main/README.md",
    );
    fireEvent.click(screen.getByRole("button", { name: "templatesSave" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "templatesFileLocation",
    );
    expect(saved).toHaveLength(0);
  });

  it("leaves a saved content directory named tree as it is", async () => {
    fetchJSON.mockImplementation(
      async (_path: string, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          const config = JSON.parse(init.body ?? "{}");
          saved.push(config);
          return stateWith(config);
        }
        return stateWith({
          enabled: false,
          sources: [
            {
              id: "community",
              repository: "https://github.com/community/templates",
              contentPath: "tree/lib",
              revision: "HEAD",
            },
          ],
        });
      },
    );
    const { location } = await renderLoaded();
    fireEvent.blur(location);
    expect(location.value).toBe(
      "https://github.com/community/templates/tree/lib",
    );
    fireEvent.click(screen.getByRole("button", { name: "templatesSave" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.sources[0]).toMatchObject({
      contentPath: "tree/lib",
      revision: "HEAD",
    });
  });
});
