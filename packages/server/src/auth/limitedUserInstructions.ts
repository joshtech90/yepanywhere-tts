import {
  defaultLimitedUserInstructions,
  instructionBlocksError,
  limitedUserInstructionsError,
  resolveLimitedUserInstructions,
  type ResolvedLimitedUserInstructions,
} from "@yep-anywhere/shared";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import type { LimitedUsersService } from "./LimitedUsersService.js";

/** Resolve limited-user instructions at launch, including background resumes. */
export function limitedUserInstructionsForLaunch(
  username: string,
  users: LimitedUsersService | undefined,
  settings: ServerSettingsService | undefined,
): ResolvedLimitedUserInstructions {
  const user = users?.get(username);
  if (!user)
    throw new Error(
      `Limited-user instructions: account ${username} no longer exists`,
    );
  const shared =
    settings?.getSetting("limitedUserInstructions") ??
    defaultLimitedUserInstructions();
  const error =
    limitedUserInstructionsError(shared) ??
    instructionBlocksError(user.instructionBlocks ?? []);
  if (error) throw new Error(`Limited-user instructions: ${error}`);
  return resolveLimitedUserInstructions(shared, user.instructionBlocks);
}
