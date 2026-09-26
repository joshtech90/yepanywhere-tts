import { removeCockpitPromptHistorySource } from "./composer";
import { removeCockpitOrganizationSource } from "./organization";

export function removeCockpitSourceStorage(sourceKey: string): void {
  removeCockpitOrganizationSource(sourceKey);
  removeCockpitPromptHistorySource(sourceKey);
}
