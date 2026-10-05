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

/**
 * Fill an inventory's unknown goal state from the last known goal command.
 * An inventory that already reports goal state wins; unknown goal state is
 * not evidence that the goal was cleared. An emulated entry — YA's
 * `/loop wish` alias for a Claude build with no native `/goal` — carries no
 * goal state by design, and replacing it would drop the provider text YA has
 * to send (topics/emulated-slash-commands.md § Claude goal commands).
 */
export function withKnownGoal(
  commands: readonly SlashCommand[] | undefined | null,
  knownGoal: SlashCommand | undefined,
): SlashCommand[] | null {
  if (!knownGoal || readGoalDetails(knownGoal)?.goalObjective === undefined) {
    return commands ? [...commands] : null;
  }
  const merged =
    commands?.map((command) =>
      command.name === GOAL_COMMAND_NAME &&
      command.invocation?.kind !== "emulated" &&
      readGoalDetails(command)?.goalObjective === undefined
        ? knownGoal
        : command,
    ) ?? null;
  if (merged?.some((command) => command.name === GOAL_COMMAND_NAME)) {
    return merged;
  }
  return [...(merged ?? []), knownGoal];
}
