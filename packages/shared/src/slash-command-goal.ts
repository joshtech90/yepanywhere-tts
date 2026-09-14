import type { SlashCommand, SlashCommandGoalDetails } from "./types.js";

/** Inventory entry name for every provider's goal control. */
export const GOAL_COMMAND_NAME = "goal";

/**
 * Goal state from whichever provider reported it. Only one provider owns a
 * given session, so the first present entry is that session's goal state.
 */
export function readGoalDetails(
  command: SlashCommand | undefined | null,
): SlashCommandGoalDetails | undefined {
  const details = command?.providerDetails;
  if (!details) return undefined;
  return details.codex ?? details.claude;
}

/** The `goal` entry of a command inventory, if the provider advertises one. */
export function findGoalCommand(
  commands: readonly SlashCommand[] | undefined | null,
): SlashCommand | undefined {
  return commands?.find((command) => command.name === GOAL_COMMAND_NAME);
}

/** Goal state reported by a command inventory, if it carries any. */
export function readInventoryGoalDetails(
  commands: readonly SlashCommand[] | undefined | null,
): SlashCommandGoalDetails | undefined {
  return readGoalDetails(findGoalCommand(commands));
}
