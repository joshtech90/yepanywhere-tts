import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "../i18n";
import { UI_KEYS } from "../lib/storageKeys";
import { CockpitNewSession } from "./CockpitNewSession";

const state = vi.hoisted(() => ({
  projects: [] as Array<{ id: string; name: string; path: string }>,
  providers: [] as unknown[],
  loaded: true,
  serverFavorites: [] as Array<{ path: string; label: string }>,
  updateSetting: vi.fn(async () => {}),
  calls: [] as string[],
  createResponse: {} as Record<string, unknown>,
  fetch: vi.fn(),
  startSession: vi.fn(),
  otherHost: false,
  otherFetch: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: {
    getServerSettings: vi.fn(async () => ({
      settings: { cockpitProjectFavorites: state.serverFavorites },
    })),
    startSession: state.startSession,
    addProject: (path: string) =>
      state.fetch("/projects", {
        method: "POST",
        body: JSON.stringify({ path }),
      }),
  },
}));

vi.mock("../lib/sourceRuntime", () => ({
  getSourceRuntimeRegistry: () => ({
    getCurrentSourceRuntime: () => ({
      transport: {
        fetch: state.otherHost ? state.otherFetch : state.fetch,
        upload: state.upload,
        uploadStagedAttachment: vi.fn(),
      },
    }),
  }),
}));

vi.mock("../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => ({
    sourceKey: "local",
    transport: {
      fetch: state.fetch,
      upload: state.upload,
      uploadStagedAttachment: vi.fn(),
    },
  }),
}));

vi.mock("../hooks/useProjects", () => ({
  useProjects: () => ({ projects: state.projects }),
}));

vi.mock("../hooks/useProviders", () => ({
  useProviders: () => ({ providers: state.providers, loading: false }),
}));

vi.mock("../hooks/useModelSettings", () => ({
  useModelSettings: () => ({ thinkingMode: "off", effortLevel: "medium" }),
}));

vi.mock("../hooks/useServerSettings", () => ({
  useServerSettings: () => ({
    settings: state.loaded
      ? {
          cockpitProjectFavorites: [
            { path: "/work/os", label: "SZ OS" },
            { path: "/work/fresh", label: "Fresh" },
          ],
        }
      : null,
    updateSetting: state.updateSetting,
  }),
}));

afterEach(cleanup);
beforeEach(() => {
  localStorage.setItem(UI_KEYS.locale, "en");
  state.projects = [];
  state.loaded = true;
  state.serverFavorites = [
    { path: "/work/os", label: "SZ OS" },
    { path: "/work/fresh", label: "Fresh" },
    { path: "/work/phone", label: "Added on the phone" },
  ];
  state.updateSetting.mockClear();
  state.providers = [];
  state.calls = [];
  state.createResponse = {
    sessionId: "s1",
    processId: "p1",
    projectId: "os",
    permissionMode: "default",
    modeVersion: 1,
    serverTimestamp: 1,
  };
  state.fetch
    .mockReset()
    .mockImplementation(async (path: string, init?: RequestInit) => {
      state.calls.push(`${init?.method ?? "GET"} ${path}`);
      return path.endsWith("/sessions/create") || path.endsWith("/sessions")
        ? state.createResponse
        : { queued: true };
    });
  state.upload.mockReset().mockImplementation(async (...args: unknown[]) => {
    state.calls.push(`upload:${(args[2] as File).name}`);
    return {
      id: "f1",
      originalName: (args[2] as File).name,
      name: "f1-notes.txt",
      path: "/uploads/s1/f1-notes.txt",
      size: 5,
      mimeType: "text/plain",
    };
  });
  state.otherHost = false;
  state.otherFetch.mockReset().mockResolvedValue(state.createResponse);
  state.startSession
    .mockReset()
    .mockImplementation(
      (projectId: string, message: string, options: unknown) =>
        (state.otherHost ? state.otherFetch : state.fetch)(
          `/projects/${projectId}/sessions`,
          {
            method: "POST",
            body: JSON.stringify({ message, ...(options as object) }),
          },
        ),
    );
});

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <CockpitNewSession basePath="" />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("Cockpit new session favourites", () => {
  it("picks a favourite's project and saves the star", async () => {
    state.projects = [
      { id: "os", name: "Smartzone OS", path: "/work/os" },
      { id: "recent", name: "Recent", path: "/work/recent" },
    ];
    renderPage();
    const select = screen.getByRole("combobox", {
      name: "Project path",
    }) as HTMLSelectElement;

    fireEvent.click(screen.getByRole("button", { name: "SZ OS" }));
    expect(select.value).toBe("os");
    expect(
      screen
        .getByRole("button", { name: "SZ OS" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.change(select, { target: { value: "recent" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save folder as favorite" }),
    );
    await vi.waitFor(() =>
      expect(state.updateSetting).toHaveBeenCalledWith(
        "cockpitProjectFavorites",
        [
          { path: "/work/os", label: "SZ OS" },
          { path: "/work/fresh", label: "Fresh" },
          { path: "/work/phone", label: "Added on the phone" },
          { path: "/work/recent", label: "Recent" },
        ],
      ),
    );
  });

  it("keeps the star off until the saved favourites are known", () => {
    state.loaded = false;
    state.projects = [{ id: "os", name: "Smartzone OS", path: "/work/os" }];
    renderPage();

    const star = screen.getByRole("button", {
      name: "Save folder as favorite",
    }) as HTMLButtonElement;
    expect(star.disabled).toBe(true);
    fireEvent.click(star);
    expect(state.updateSetting).not.toHaveBeenCalled();
  });

  it("types an unknown folder in and moves to its project once known", () => {
    const { rerender } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Fresh" }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "Project path",
        }) as HTMLInputElement
      ).value,
    ).toBe("/work/fresh");

    state.projects = [{ id: "fresh", name: "Fresh", path: "/work/fresh" }];
    rerender(
      <MemoryRouter>
        <I18nProvider>
          <CockpitNewSession basePath="" />
        </I18nProvider>
      </MemoryRouter>,
    );
    expect(
      (
        screen.getByRole("combobox", {
          name: "Project path",
        }) as HTMLSelectElement
      ).value,
    ).toBe("fresh");
    expect(screen.queryByRole("textbox", { name: "Project path" })).toBeNull();
  });
});

const claudeProvider = {
  name: "claude",
  displayName: "Claude",
  installed: true,
  authenticated: true,
  enabled: true,
  models: [{ id: "sonnet", name: "Sonnet" }],
};

function dropFileAndStart() {
  state.projects = [{ id: "os", name: "Smartzone OS", path: "/work/os" }];
  state.providers = [claudeProvider];
  renderPage();
  const file = new File(["hello"], "notes.txt", { type: "text/plain" });
  fireEvent.drop(screen.getByRole("form"), {
    dataTransfer: { files: [file], types: ["Files"] },
  });
  expect(screen.getByText("notes.txt")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "First message" }), {
    target: { value: "Look at this" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Start session" }));
  return file;
}

describe("Cockpit new session attachments", () => {
  it("creates the session, uploads a dropped file and sends it with the first message", async () => {
    const file = dropFileAndStart();

    await vi.waitFor(() =>
      expect(state.calls).toEqual([
        "POST /projects/os/sessions/create",
        "upload:notes.txt",
        "POST /sessions/s1/messages",
      ]),
    );
    expect(state.startSession).not.toHaveBeenCalled();
    expect(state.upload.mock.calls[0]?.slice(0, 3)).toEqual(["os", "s1", file]);
    const body = JSON.parse(
      (state.fetch.mock.calls[1] as [string, RequestInit])[1].body as string,
    );
    expect(body.message).toBe("Look at this");
    expect(
      body.attachments.map((attachment: { path: string }) => attachment.path),
    ).toEqual(["/uploads/s1/f1-notes.txt"]);
  });

  it("gives a stalled upload up and frees the form", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      state.upload.mockReset().mockImplementation(() => new Promise(() => {}));
      dropFileAndStart();
      await vi.waitFor(() => expect(state.upload).toHaveBeenCalled());

      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(() =>
        expect(screen.getByRole("alert").textContent).toMatch(/upload/i),
      );
      expect(state.calls).not.toContain("POST /sessions/s1/messages");
      expect(
        (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("withdraws a creation the host only queued instead of uploading", async () => {
    state.createResponse = { queued: true, queueId: "q1", position: 1 };
    dropFileAndStart();

    await vi.waitFor(() =>
      expect(state.calls).toEqual([
        "POST /projects/os/sessions/create",
        "DELETE /queue/q1",
      ]),
    );
    expect(state.upload).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Server is busy. Please try again in a moment.",
    );
  });
});

describe("Cockpit new session keyboard submission", () => {
  it("keeps composition, shifted and repeated Enter in the editor", async () => {
    state.projects = [{ id: "os", name: "Smartzone OS", path: "/work/os" }];
    state.providers = [claudeProvider];
    renderPage();
    const input = screen.getByRole("textbox", { name: "First message" });
    fireEvent.change(input, {
      target: { value: "Draft still being composed" },
    });
    for (const flags of [
      { isComposing: true },
      { keyCode: 229 },
      { repeat: true },
      { shiftKey: true },
    ]) {
      fireEvent.keyDown(input, { key: "Enter", ...flags });
      expect(state.fetch).not.toHaveBeenCalled();
    }
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("Cockpit new session source ownership", () => {
  it.each([false, true])(
    "keeps delayed folder resolution on its original host (files: %s)",
    async (withFile) => {
      state.providers = [claudeProvider];
      let resolveProject!: (value: unknown) => void;
      state.fetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveProject = resolve;
          }),
      );
      const view = renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Fresh" }));
      fireEvent.change(screen.getByRole("textbox", { name: "First message" }), {
        target: { value: "Stay on this host" },
      });
      if (withFile)
        fireEvent.drop(screen.getByRole("form"), {
          dataTransfer: {
            files: [new File(["hello"], "notes.txt", { type: "text/plain" })],
            types: ["Files"],
          },
        });
      fireEvent.click(screen.getByRole("button", { name: "Start session" }));
      expect(state.fetch.mock.calls[0]?.[0]).toBe("/projects");
      state.otherHost = true;
      view.unmount();
      await act(async () => {
        resolveProject({ project: { id: "os" } });
      });
      expect(state.otherFetch).not.toHaveBeenCalled();
      expect(state.fetch.mock.calls[1]?.[0]).toBe(
        withFile ? "/projects/os/sessions/create" : "/projects/os/sessions",
      );
      if (withFile) expect(state.calls).toContain("POST /sessions/s1/messages");
    },
  );
});
