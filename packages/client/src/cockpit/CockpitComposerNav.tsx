import { createContext, useContext, type ReactNode } from "react";

/**
 * On a phone the open session drops the labelled bottom navigation; the
 * composer shows the same destinations as small icons in its toolbar, so the
 * input sits at the bottom of the screen (Joscha 26.09.2026).
 */
const CockpitComposerNavContext = createContext<ReactNode>(null);

export const CockpitComposerNavProvider = CockpitComposerNavContext.Provider;

export function useCockpitComposerNav(): ReactNode {
  return useContext(CockpitComposerNavContext);
}
