import { useProjectPathLinkSettings } from "../contexts/ProjectPathLinkSettingsContext";
import { projectPathLinkStores } from "../lib/projectPathLinkPreferences";

const store = projectPathLinkStores.recentBasenames;

export const getRecentProjectPathLinksPreference = store.read;
export const setRecentProjectPathLinksPreference = store.set;
export const subscribeRecentProjectPathLinksPreference = store.subscribe;

export function useRecentProjectPathLinks() {
  const { projectPaths, recentBasenames } = useProjectPathLinkSettings();
  return {
    recentProjectPathLinksEnabled: projectPaths && recentBasenames,
    setRecentProjectPathLinksEnabled: store.set,
  };
}
