import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  createSession: vi.fn(),
  queueMessage: vi.fn(),
  startSession: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("../api/client", () => ({
  api: {
    getServerSettings: vi.fn(async () => ({
      settings: { cockpitProjectFavorites: state.serverFavorites },
    })),
    createSession: state.createSession,
    queueMessage: state.queueMessage,
    startSession: state.startSession,
  },
}));

vi.mock("../contexts/SourceRuntimeContext", () => ({
  useCurrentSourceRuntime: () => ({
    sourceKey: "local",
    transport: { upload: state.upload, uploadStagedAttachment: vi.fn() },
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
  state.createSession.mockReset().mockImplementation(async () => {
    state.calls.push("create");
    return {
      sessionId: "s1",
      processId: "p1",
      projectId: "os",
      permissionMode: "default",
      modeVersion: 1,
      serverTimestamp: 1,
    };
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
  state.queueMessage.mockReset().mockImplementation(async () => {
    state.calls.push("queue");
    return { queued: true };
  });
  state.startSession.mockReset();
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

describe("Cockpit new session attachments", () => {
  it("creates the session, uploads a dropped file and sends it with the first message", async () => {
    state.projects = [{ id: "os", name: "Smartzone OS", path: "/work/os" }];
    state.providers = [
      {
        name: "claude",
        displayName: "Claude",
        installed: true,
        authenticated: true,
        enabled: true,
        models: [{ id: "sonnet", name: "Sonnet" }],
      },
    ];
    renderPage();

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const form = screen.getByRole("form");
    fireEvent.drop(form, { dataTransfer: { files: [file], types: ["Files"] } });
    expect(screen.getByText("notes.txt")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "First message" }), {
      target: { value: "Look at this" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));

    await vi.waitFor(() =>
      expect(state.calls).toEqual(["create", "upload:notes.txt", "queue"]),
    );
    expect(state.startSession).not.toHaveBeenCalled();
    expect(state.upload.mock.calls[0]?.slice(0, 3)).toEqual(["os", "s1", file]);
    const [sessionId, text, , attachments] = state.queueMessage.mock
      .calls[0] as [string, string, unknown, Array<{ path: string }>];
    expect(sessionId).toBe("s1");
    expect(text).toBe("Look at this");
    expect(attachments.map((attachment) => attachment.path)).toEqual([
      "/uploads/s1/f1-notes.txt",
    ]);
  });
});
