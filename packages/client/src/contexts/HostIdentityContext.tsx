import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useServerSettings } from "../hooks/useServerSettings";

interface HostIdentityContextValue {
  icon: string | null;
}

const HostIdentityContext = createContext<HostIdentityContextValue>({
  icon: null,
});

export function HostIdentityProvider({ children }: { children: ReactNode }) {
  const { settings } = useServerSettings();
  const value = useMemo<HostIdentityContextValue>(
    () => ({
      icon: settings?.hostIdentity?.icon ?? null,
    }),
    [settings?.hostIdentity?.icon],
  );

  return (
    <HostIdentityContext.Provider value={value}>
      {children}
    </HostIdentityContext.Provider>
  );
}

export function useHostIdentity(): HostIdentityContextValue {
  return useContext(HostIdentityContext);
}
