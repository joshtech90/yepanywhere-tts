import { SERVER_CAPABILITIES, serverHasCapability } from "@yep-anywhere/shared";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useServerSettings } from "./useServerSettings";
import { useRetainedVersionInfo } from "./useVersion";

/** The current server hosts MCP App views and the operator turned them on. */
export function useMcpAppViewsEnabled(): boolean {
  const runtime = useCurrentSourceRuntime();
  const version = useRetainedVersionInfo(runtime.sourceKey);
  const { settings } = useServerSettings();
  return (
    settings?.mcpAppViews === true &&
    serverHasCapability(version, SERVER_CAPABILITIES.mcpAppViews.name)
  );
}
