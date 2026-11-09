import type {
  SessionCreationReceipt,
  StagedAttachmentRef,
} from "@yep-anywhere/shared";
import type { SessionOptions } from "../../api/client";
import type { SourceTransport } from "../../lib/transport/types";

/**
 * One request of upstream's durable session creation (`session-creations`,
 * upstream 085beaf0a retired `POST /projects/:id/sessions` and `/create`).
 * The host replays its saved receipt for a repeated request ID, so a caller
 * that keeps the ID after an unanswered request cannot start a second session.
 */
export interface CockpitSessionCreationRequest {
  requestId: string;
  message: string;
  options: SessionOptions;
  clientTimestamp: number;
  stagedAttachments?: StagedAttachmentRef[];
}

/** A 4xx reply is the host's final word; anything else leaves it open. */
export function isFinalCreationRefusal(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

export async function requestCockpitSessionCreation(
  transport: Pick<SourceTransport, "fetch">,
  projectId: string,
  request: CockpitSessionCreationRequest,
): Promise<SessionCreationReceipt> {
  const { requestId, message, options, clientTimestamp, stagedAttachments } =
    request;
  try {
    return await transport.fetch<SessionCreationReceipt>(
      `/projects/${encodeURIComponent(projectId)}/session-creations`,
      {
        method: "POST",
        body: JSON.stringify({
          ...options,
          requestId,
          message,
          clientTimestamp,
          ...(stagedAttachments?.length ? { stagedAttachments } : {}),
        }),
      },
    );
  } catch (error) {
    if (isFinalCreationRefusal(error)) throw error;
    // A failed reply does not prove the host saved nothing.
    const saved = await transport
      .fetch<SessionCreationReceipt>(
        `/session-creations/${encodeURIComponent(requestId)}`,
      )
      .catch(() => null);
    if (saved?.requestId === requestId && saved.sessionId) return saved;
    throw error;
  }
}
