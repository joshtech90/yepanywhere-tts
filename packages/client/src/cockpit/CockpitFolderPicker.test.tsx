import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { I18nProvider } from "../i18n";
import { CockpitFolderPicker } from "./CockpitFolderPicker";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function listing(path: string, names: string[]) {
  return {
    path,
    parent: path === "/" ? null : path.replace(/\/[^/]+$/, "") || "/",
    home: "/Users/j",
    entries: names.map((name) => ({ name, path: `${path}/${name}` })),
    truncated: false,
  };
}

describe("Cockpit folder picker", () => {
  let browse: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    browse = vi
      .spyOn(api, "browseDirectories")
      .mockImplementation(async (path?: string) => {
        if (path === "/Users/j/Gone") {
          throw Object.assign(new Error("gone"), { status: 404 });
        }
        if (path === "/Users/j/Projects") {
          return listing("/Users/j/Projects", ["China Autos", "Smartzone OS"]);
        }
        return listing("/Users/j", ["Documents", "Projects"]);
      });
  });

  it("walks into a folder and picks the folder on screen", async () => {
    const onPick = vi.fn();
    render(
      <I18nProvider>
        <CockpitFolderPicker onClose={vi.fn()} onPick={onPick} />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Projects" }));
    await screen.findByRole("button", { name: "Smartzone OS" });
    expect(screen.getByText("~/Projects")).toBeTruthy();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Filter folders" }),
      {
        target: { value: "china" },
      },
    );
    await vi.waitFor(() =>
      expect(screen.queryByRole("button", { name: "Smartzone OS" })).toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Use this folder" }));
    expect(onPick).toHaveBeenCalledWith("/Users/j/Projects");
  });

  it("starts at home when the remembered folder is gone", async () => {
    render(
      <I18nProvider>
        <CockpitFolderPicker
          initialPath="/Users/j/Gone"
          onClose={vi.fn()}
          onPick={vi.fn()}
        />
      </I18nProvider>,
    );

    await screen.findByRole("button", { name: "Documents" });
    expect(browse).toHaveBeenCalledWith("/Users/j/Gone");
    expect(browse).toHaveBeenLastCalledWith(undefined);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps letters typed while a folder is still loading", async () => {
    let release: () => void = () => {};
    browse.mockImplementation(async (path?: string) => {
      if (path === "/Users/j/Projects") {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return listing("/Users/j/Projects", ["China Autos", "Smartzone OS"]);
      }
      return listing("/Users/j", ["Documents", "Projects"]);
    });
    render(
      <I18nProvider>
        <CockpitFolderPicker onClose={vi.fn()} onPick={vi.fn()} />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Projects" }));
    const filter = screen.getByRole("searchbox", {
      name: "Filter folders",
    }) as HTMLInputElement;
    for (const letter of "smart") {
      fireEvent.change(filter, { target: { value: filter.value + letter } });
    }
    release();

    await screen.findByRole("button", { name: "Smartzone OS" });
    expect(filter.value).toBe("smart");
    expect(screen.queryByRole("button", { name: "China Autos" })).toBeNull();
  });
});
