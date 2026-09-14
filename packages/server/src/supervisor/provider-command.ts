import type { DurableLocalCommandMessage } from "@yep-anywhere/shared";
import type { SessionMetadataService } from "../metadata/SessionMetadataService.js";
import type { Process } from "./Process.js";

/** Native controls share acknowledgement and persistence across send paths. */
export async function dispatchProviderCommand(
  process: Process,
  command: { name: string; argument: string },
  tempId: string | undefined,
  metadata: SessionMetadataService | undefined,
) {
  if (process.supportsNativeCommands) {
    // Claude Code starts only when it receives a prompt, so holding this
    // command back until the session id arrives would wait for an event that
    // this very message has to trigger. Those providers read a leading slash
    // command out of ordinary input, so let it be delivered that way.
    if (process.awaitingFirstMessageToStart) return { handled: false };
    await process.waitForProviderSessionId();
  }
  return process.runProviderCommand(command.name, command.argument, {
    tempId,
    ...(command.name === "goal" && metadata
      ? {
          persistOutput: (message: DurableLocalCommandMessage) =>
            metadata.addLocalCommandMessage(message.session_id, message),
        }
      : {}),
  });
}
