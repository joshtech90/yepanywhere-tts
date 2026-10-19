import { useSyncExternalStore } from "react";
import { createLocalStorageBoolean } from "./localStorageValue";
import { UI_KEYS } from "./storageKeys";

export const projectPathLinkStores = {
  projectPaths: createLocalStorageBoolean(UI_KEYS.projectPathLinks, true),
  recentBasenames: createLocalStorageBoolean(
    UI_KEYS.recentProjectPathLinks,
    false,
  ),
  mentionedDirectories: createLocalStorageBoolean(
    UI_KEYS.mentionedDirectoryLinks,
    true,
  ),
};

export interface ProjectPathLinkSettings {
  projectPaths: boolean;
  recentBasenames: boolean;
  mentionedDirectories: boolean;
}

export function useGlobalProjectPathLinkSettings(): ProjectPathLinkSettings {
  const projectPaths = useSyncExternalStore(
    projectPathLinkStores.projectPaths.subscribe,
    projectPathLinkStores.projectPaths.read,
    projectPathLinkStores.projectPaths.read,
  );
  const recentBasenames = useSyncExternalStore(
    projectPathLinkStores.recentBasenames.subscribe,
    projectPathLinkStores.recentBasenames.read,
    projectPathLinkStores.recentBasenames.read,
  );
  const mentionedDirectories = useSyncExternalStore(
    projectPathLinkStores.mentionedDirectories.subscribe,
    projectPathLinkStores.mentionedDirectories.read,
    projectPathLinkStores.mentionedDirectories.read,
  );
  return { projectPaths, recentBasenames, mentionedDirectories };
}
