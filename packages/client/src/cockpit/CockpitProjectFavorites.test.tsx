import type { CockpitProjectFavorite } from "@yep-anywhere/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import {
  CockpitProjectFavorites,
  type CockpitProjectFavoritesController,
  useCockpitProjectFavoriteMenu,
} from "./CockpitProjectFavorites";

afterEach(cleanup);

const FAVORITES: CockpitProjectFavorite[] = [
  { path: "/Users/j/Projects/Smartzone OS", label: "SZ OS" },
  { path: "/Users/j/Projects/China Autos", label: "China Autos" },
];

function controller(
  favorites: CockpitProjectFavorite[] = FAVORITES,
): CockpitProjectFavoritesController {
  return {
    favorites,
    save: vi.fn(async () => true),
    saving: false,
    failed: false,
  };
}

function Harness({
  favorites,
  currentPath = null,
  onChoose = vi.fn(),
}: {
  favorites: CockpitProjectFavoritesController;
  currentPath?: string | null;
  onChoose?: (favorite: CockpitProjectFavorite) => void;
}) {
  const menu = useCockpitProjectFavoriteMenu(favorites);
  return (
    <>
      <CockpitProjectFavorites
        controller={favorites}
        currentPath={currentPath}
        onChoose={onChoose}
        onOpenMenu={menu.open}
      />
      {menu.element}
    </>
  );
}

function renderHarness(props: Parameters<typeof Harness>[0]) {
  return render(
    <I18nProvider>
      <Harness {...props} />
    </I18nProvider>,
  );
}

describe("Cockpit project favourites", () => {
  it("picks a folder with one click and marks the current one", () => {
    const onChoose = vi.fn();
    renderHarness({
      favorites: controller(),
      currentPath: "/Users/j/Projects/China Autos/",
      onChoose,
    });

    const autos = screen.getByRole("button", { name: "China Autos" });
    expect(autos.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "SZ OS" })
        .getAttribute("aria-pressed"),
    ).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "SZ OS" }));
    expect(onChoose).toHaveBeenCalledWith(FAVORITES[0]);
  });

  it("explains the star while there are no favourites", () => {
    renderHarness({ favorites: controller([]) });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/star/i)).toBeTruthy();
  });

  it("renames and removes a favourite from its context menu", async () => {
    const favorites = controller();
    renderHarness({ favorites });

    fireEvent.contextMenu(screen.getByRole("button", { name: "SZ OS" }), {
      clientX: 30,
      clientY: 40,
    });
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Rename", "Remove from favorites"]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Favorite name" });
    fireEvent.change(input, { target: { value: "Smartzone" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() =>
      expect(favorites.save).toHaveBeenCalledWith([
        { ...FAVORITES[0], label: "Smartzone" },
        FAVORITES[1],
      ]),
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "China Autos" }), {
      clientX: 30,
      clientY: 40,
    });
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Remove from favorites" }),
    );
    await vi.waitFor(() =>
      expect(favorites.save).toHaveBeenLastCalledWith([FAVORITES[0]]),
    );
  });
});
