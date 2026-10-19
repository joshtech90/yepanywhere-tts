import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  type ProjectPathLinkSettings,
  useGlobalProjectPathLinkSettings,
} from "../lib/projectPathLinkPreferences";

const ProjectPathLinkSettingsContext = createContext<{
  overrides: Partial<ProjectPathLinkSettings>;
  setOverride: (
    key: keyof ProjectPathLinkSettings,
    value: boolean | undefined,
  ) => void;
} | null>(null);

export function ProjectPathLinkSettingsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [overrides, setOverrides] = useState<Partial<ProjectPathLinkSettings>>(
    {},
  );
  const value = useMemo(
    () => ({
      overrides,
      setOverride: (
        key: keyof ProjectPathLinkSettings,
        value: boolean | undefined,
      ) => {
        setOverrides((current) => ({ ...current, [key]: value }));
      },
    }),
    [overrides],
  );
  return (
    <ProjectPathLinkSettingsContext.Provider value={value}>
      {children}
    </ProjectPathLinkSettingsContext.Provider>
  );
}

/** Session overrides inherit current global preferences until explicitly set. */
export function useProjectPathLinkSettings() {
  const global = useGlobalProjectPathLinkSettings();
  const session = useContext(ProjectPathLinkSettingsContext);
  return {
    projectPaths: session?.overrides.projectPaths ?? global.projectPaths,
    recentBasenames:
      session?.overrides.recentBasenames ?? global.recentBasenames,
    mentionedDirectories:
      session?.overrides.mentionedDirectories ?? global.mentionedDirectories,
    session,
  };
}
