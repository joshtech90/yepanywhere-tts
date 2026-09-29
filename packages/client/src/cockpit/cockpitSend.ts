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
 * Sends one message the way the composer does: an unowned session is resumed
 * with it, an owned one receives it on its message route. The caller owns
 * pending echoes and error presentation; this only talks to the server and
 * adopts the process it reports.
 */
export async function sendCockpitDirectMessage({
  transport,
  projectId,
  port,
  text,
  tempId,
  submittedAt,
  attachments,
  messageMetadata,
}: CockpitDirectSend): Promise<void> {
  const clientTimestamp = Date.parse(submittedAt);
  if (port.status.owner === "none") {
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
        clientTimestamp,
        messageMetadata,
        mode: port.permissionMode,
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
    return;
  }
  const result = await transport.fetch<{
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
      clientTimestamp,
      messageMetadata,
    }),
  });
  if (result.restarted && result.processId) {
    port.setStatus({ owner: "self", processId: result.processId });
    port.reconnectStream();
  }
}
