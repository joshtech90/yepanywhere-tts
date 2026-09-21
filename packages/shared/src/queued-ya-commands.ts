/**
 * Which YA-emulated slash commands may be queued for later server execution,
 * and which may only run against the live composer.
 *
 * A YA-emulated command is not provider text: the composer normally consumes
 * it and performs the operation immediately. That is wrong when the user chose
 * a delayed delivery lane such as Project Queue, where the point is to run the
 * command later. Queueable commands are carried verbatim as a tagged
 * `yaCommand` on the queued item and executed by the server at dispatch, the
 * same routing-at-ingress rule `topics/emulated-slash-commands.md` states for
 * the per-session YA-command lane.
 */

/** Emulated commands the server can execute from a queue entry. */
export const QUEUEABLE_YA_COMMANDS = ["clear", "clearloop"] as const;

export type QueuedYaCommandName = (typeof QUEUEABLE_YA_COMMANDS)[number];

/**
 * Emulated commands that are schedulable in principle but have no queued
 * execution path yet. `/fork N` creates a *new* session, so a queued fork
 * would have to change its own item's target; that is a separate design.
 */
export const UNSUPPORTED_QUEUED_YA_COMMANDS = ["fork"] as const;

export type UnsupportedQueuedYaCommandName =
  (typeof UNSUPPORTED_QUEUED_YA_COMMANDS)[number];

/**
 * Emulated commands that act on composer or client state and therefore cannot
 * be handed to a scheduler. Queueing one would have to either run it now
 * (defeating the request) or run it later against a composer that no longer
 * exists, so they are refused at enqueue instead.
 */
export const COMPOSER_ONLY_YA_COMMANDS = [
  "model",
  "btw",
  "done",
  "archive",
  "terminate",
  "title",
  "compact",
] as const;

export type ComposerOnlyYaCommandName =
  (typeof COMPOSER_ONLY_YA_COMMANDS)[number];

/** A queued YA command: the command name plus its verbatim argument text. */
export interface QueuedYaCommand {
  name: QueuedYaCommandName;
  /** Raw text after the command name, unparsed and untrimmed of inner form. */
  argument: string;
}

export type QueuedYaCommandClassification =
  | { kind: "prompt" }
  | { kind: "queueable"; command: QueuedYaCommand; commandText: string }
  | { kind: "composer-only"; name: ComposerOnlyYaCommandName }
  | { kind: "unsupported"; name: UnsupportedQueuedYaCommandName };

const ALIASES: Record<string, string> = {
  m: "model",
  b: "btw",
  d: "done",
};

function isQueueable(name: string): name is QueuedYaCommandName {
  return (QUEUEABLE_YA_COMMANDS as readonly string[]).includes(name);
}

function isComposerOnly(name: string): name is ComposerOnlyYaCommandName {
  return (COMPOSER_ONLY_YA_COMMANDS as readonly string[]).includes(name);
}

/**
 * Decide how composer text should reach a delayed delivery lane. Anything that
 * is not a YA-emulated command — ordinary prose, a provider command, a skill
 * line, an effort modifier such as `/fast …` — is `prompt` and queues as text.
 */
export function classifyQueuedYaCommand(
  text: string,
): QueuedYaCommandClassification {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match) return { kind: "prompt" };
  const authored = match[1]?.toLowerCase() ?? "";
  const name = ALIASES[authored] ?? authored;
  const argument = match[2] ?? "";
  if (isQueueable(name)) {
    const trimmed = argument.trim();
    return {
      kind: "queueable",
      command: { name, argument: trimmed },
      commandText: trimmed ? `/${name} ${trimmed}` : `/${name}`,
    };
  }
  if (isComposerOnly(name)) return { kind: "composer-only", name };
  if ((UNSUPPORTED_QUEUED_YA_COMMANDS as readonly string[]).includes(name)) {
    return {
      kind: "unsupported",
      name: name as UnsupportedQueuedYaCommandName,
    };
  }
  return { kind: "prompt" };
}
