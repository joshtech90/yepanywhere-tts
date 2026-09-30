import type { CockpitProjectFavorite } from "@yep-anywhere/shared";
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";
import { useServerSettings } from "../hooks/useServerSettings";
import { useI18n } from "../i18n";
import { CockpitSessionMenu } from "./CockpitSessionMenu";
import type { CockpitSessionMenuAnchor } from "./CockpitSessionRow";
import {
  folderKey,
  removeFavorite,
  renameFavorite,
} from "./core/projectFavorites";
import styles from "./CockpitProjectFavorites.module.css";
import { useCockpitLongPress } from "./useCockpitLongPress";

export interface CockpitProjectFavoritesController {
  favorites: CockpitProjectFavorite[];
  /** Stores the next list; false when the server refused or is too old. */
  save: (next: CockpitProjectFavorite[]) => Promise<boolean>;
  saving: boolean;
  failed: boolean;
}

/**
 * The favourite folders live in the server settings, so the Mac and the
 * phone see the same list for the same host.
 */
export function useCockpitProjectFavorites(): CockpitProjectFavoritesController {
  const { settings, updateSetting } = useServerSettings();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const favorites = settings?.cockpitProjectFavorites ?? [];
  const save = useCallback(
    async (next: CockpitProjectFavorite[]) => {
      setSaving(true);
      setFailed(false);
      try {
        await updateSetting("cockpitProjectFavorites", next);
        return true;
      } catch {
        setFailed(true);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [updateSetting],
  );
  return { favorites, save, saving, failed };
}

interface FavoriteChipProps {
  favorite: CockpitProjectFavorite;
  selected: boolean;
  onChoose: (favorite: CockpitProjectFavorite) => void;
  onOpenMenu: (
    favorite: CockpitProjectFavorite,
    anchor: CockpitSessionMenuAnchor,
  ) => void;
}

function FavoriteChip({
  favorite,
  selected,
  onChoose,
  onOpenMenu,
}: FavoriteChipProps) {
  const longPress = useCockpitLongPress((point) => onOpenMenu(favorite, point));
  const handleContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    // A keyboard-invoked context menu reports no pointer position.
    if (event.clientX === 0 && event.clientY === 0) {
      const rect = event.currentTarget.getBoundingClientRect();
      onOpenMenu(favorite, { x: rect.left, y: rect.bottom + 4 });
      return;
    }
    onOpenMenu(favorite, { x: event.clientX, y: event.clientY });
  };
  return (
    <button
      aria-pressed={selected}
      className={styles.chip}
      onClick={() => onChoose(favorite)}
      onContextMenu={handleContextMenu}
      title={favorite.path}
      type="button"
      {...longPress}
    >
      {favorite.label}
    </button>
  );
}

/**
 * The rename/remove menu of the favourites. It is returned as an element for
 * the caller to place outside its form: the menu's rename field is a form of
 * its own, and forms do not nest.
 */
export function useCockpitProjectFavoriteMenu(
  controller: CockpitProjectFavoritesController,
): {
  element: ReactNode;
  open: (
    favorite: CockpitProjectFavorite,
    anchor: CockpitSessionMenuAnchor,
  ) => void;
} {
  const { t } = useI18n();
  const [menu, setMenu] = useState<{
    favorite: CockpitProjectFavorite;
    anchor: CockpitSessionMenuAnchor;
  } | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const open = useCallback(
    (favorite: CockpitProjectFavorite, anchor: CockpitSessionMenuAnchor) =>
      setMenu({ favorite, anchor }),
    [],
  );
  // The menu acts on the list as it is when the action runs.
  const favoritesRef = useRef(controller.favorites);
  favoritesRef.current = controller.favorites;
  const { save, saving } = controller;
  const element = menu ? (
    <CockpitSessionMenu
      anchor={menu.anchor}
      busy={saving}
      confirmArchive={false}
      copy={{
        ariaLabel: t("cockpitProjectFavoriteMenuAria", {
          name: menu.favorite.label,
        }),
        renameInput: t("cockpitProjectFavoriteRenameInput"),
        renameError: t("cockpitProjectFavoritesSaveError"),
        archive: t("cockpitProjectFavoriteRemove"),
        archiveError: t("cockpitProjectFavoritesSaveError"),
      }}
      key={menu.favorite.path}
      onArchive={() =>
        save(removeFavorite(favoritesRef.current, menu.favorite.path))
      }
      onClose={close}
      onRename={(label) =>
        save(renameFavorite(favoritesRef.current, menu.favorite.path, label))
      }
      onTogglePin={() => {}}
      open
      pinned={false}
      sessionTitle={menu.favorite.label}
      showPin={false}
    />
  ) : null;
  return { element, open };
}

export interface CockpitProjectFavoritesProps {
  controller: CockpitProjectFavoritesController;
  /** The folder the form currently starts in, to mark its favourite. */
  currentPath: string | null;
  onChoose: (favorite: CockpitProjectFavorite) => void;
  onOpenMenu: (
    favorite: CockpitProjectFavorite,
    anchor: CockpitSessionMenuAnchor,
  ) => void;
}

/**
 * One click on a favourite picks its folder; right click, the context-menu
 * key or a long press renames or removes it (Joscha 30.09.2026).
 */
export function CockpitProjectFavorites({
  controller,
  currentPath,
  onChoose,
  onOpenMenu,
}: CockpitProjectFavoritesProps) {
  const { t } = useI18n();
  const currentKey = currentPath ? folderKey(currentPath) : null;
  const { favorites, failed } = controller;

  return (
    <div className={styles.field}>
      <span className={styles.label} id="cockpit-project-favorites-label">
        {t("cockpitProjectFavoritesTitle")}
      </span>
      {favorites.length > 0 ? (
        <div
          aria-labelledby="cockpit-project-favorites-label"
          className={styles.chips}
          role="group"
        >
          {favorites.map((favorite) => (
            <FavoriteChip
              favorite={favorite}
              key={favorite.path}
              onChoose={onChoose}
              onOpenMenu={onOpenMenu}
              selected={folderKey(favorite.path) === currentKey}
            />
          ))}
        </div>
      ) : (
        <p className={styles.hint}>{t("cockpitProjectFavoritesHint")}</p>
      )}
      {failed && (
        <p className={styles.error} role="status">
          {t("cockpitProjectFavoritesSaveError")}
        </p>
      )}
    </div>
  );
}
