import type { UploadedFile } from "@yep-anywhere/shared";
import type { SourceTransport } from "../lib/transport";
import {
  getShowThinkingSetting,
  getThinkingSetting,
} from "../hooks/useModelSettings";
import type { PermissionMode } from "../types";
import type { CockpitComposerSessionPort } from "./useCockpitComposer";

export interface CockpitDirectSend {
  transport: Pick<SourceTransport, "fetch">;
  projectId: string;
  port: CockpitComposerSessionPort;
  text: string;
  tempId: string;
  submittedAt: string;
  attachments?: UploadedFile[];
  messageMetadata?: unknown;
}

/**
 * The message route refused the message because this view's own process is
 * gone (reaped while idle, or the server restarted while the phone slept)
 * and the view has not heard about it yet. Nothing was accepted, so the same
 * message may be resumed with. A session another program controls is never
 * taken over this way.
 */
export function isCockpitProcessGone(
  error: unknown,
  port: Pick<CockpitComposerSessionPort, "status">,
): boolean {
  if (port.status.owner !== "self") return false;
  const status = (error as { status?: unknown } | null)?.status;
  return status === 404 || status === 410;
}

/** Starts the session's process again with this message as its turn. */
export async function resumeCockpitSession({
  transport,
  projectId,
  port,
  text,
  tempId,
  submittedAt,
  attachments,
  messageMetadata,
}: CockpitDirectSend): Promise<void> {
  const result = await transport.fetch<{
    processId: string;
    permissionMode: PermissionMode;
    appliedPermissionMode?: PermissionMode;
    modeVersion: number;
    recapAfterSeconds?: number;
  }>(`/projects/${projectId}/sessions/${port.actualSessionId}/resume`, {
    method: "POST",
    body: JSON.stringify({
      message: text,
      attachments: attachments?.length ? attachments : undefined,
      tempId,
      clientTimestamp: Date.parse(submittedAt),
      messageMetadata,
      // Without a live process "default" is only the view's placeholder;
      // leave the mode out so the server restores the session's own mode
      // or the owner's standing default instead of downgrading it.
      mode: port.permissionMode === "default" ? undefined : port.permissionMode,
      model: port.session?.model,
      provider: port.session?.provider,
      thinking: getThinkingSetting(),
      showThinking: getShowThinkingSetting(),
    }),
  });
  port.setStatus({
    owner: "self",
    processId: result.processId,
    permissionMode: result.permissionMode,
    appliedPermissionMode: result.appliedPermissionMode,
    modeVersion: result.modeVersion,
    recapAfterSeconds: result.recapAfterSeconds,
  });
}

/**
 * Sends one message the way the composer does: an unowned session is resumed
 * with it, an owned one receives it on its message route. The caller owns
 * pending echoes and error presentation; this only talks to the server and
 * adopts the process it reports.
 */
export async function sendCockpitDirectMessage(
  send: CockpitDirectSend,
): Promise<void> {
  const { transport, port, text, tempId, submittedAt, attachments } = send;
  if (port.status.owner === "none") {
    await resumeCockpitSession(send);
    return;
  }
  let result: { restarted?: boolean; processId?: string };
  try {
    result = await transport.fetch<{
      restarted?: boolean;
      processId?: string;
    }>(`/sessions/${port.actualSessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        message: text,
        mode: port.permissionMode,
        attachments: attachments?.length ? attachments : undefined,
        tempId,
        thinking: getThinkingSetting(),
        showThinking: getShowThinkingSetting(),
        clientTimestamp: Date.parse(submittedAt),
        messageMetadata: send.messageMetadata,
      }),
    });
  } catch (error) {
    if (!isCockpitProcessGone(error, port)) throw error;
    await resumeCockpitSession(send);
    return;
  }
  if (result.restarted && result.processId) {
    port.setStatus({ owner: "self", processId: result.processId });
    port.reconnectStream();
  }
}
