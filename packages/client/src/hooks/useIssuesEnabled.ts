import { SERVER_CAPABILITIES, serverHasCapability } from "@yep-anywhere/shared";
import { useVersion } from "./useVersion";
import { useServerSettings } from "./useServerSettings";
export function useIssuesEnabled() {
  const { version: versionInfo } = useVersion();
  const { settings } = useServerSettings();
  return (
    serverHasCapability(
      versionInfo,
      SERVER_CAPABILITIES.issueSessionAssociations.name,
    ) && settings?.issueAssociations?.enabled === true
  );
}
