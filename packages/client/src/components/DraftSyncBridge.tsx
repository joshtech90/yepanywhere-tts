import { useEffect } from "react";
import { SERVER_CAPABILITIES, serverHasCapability } from "@yep-anywhere/shared";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useActingPrincipal } from "../hooks/useActingPrincipal";
import { useVersion } from "../hooks/useVersion";
import { DraftSyncClient, setDraftAccount } from "../lib/draftSyncStorage";

export function DraftSyncBridge() {
  const runtime = useCurrentSourceRuntime();
  const { version } = useVersion();
  const { principal, resolved } = useActingPrincipal();
  const owner = principal.username ?? "";
  const supported = serverHasCapability(
    version ?? undefined,
    SERVER_CAPABILITIES.draftSync.name,
  );
  useEffect(() => {
    if (!resolved) return;
    setDraftAccount(runtime.sourceKey, owner);
    if (!supported) return;
    const client = new DraftSyncClient(
      runtime.sourceKey,
      owner,
      runtime.transport,
    );
    client.start();
    return () => client.stop();
  }, [runtime, owner, resolved, supported]);
  return null;
}
