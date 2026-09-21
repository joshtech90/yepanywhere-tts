import {
  RETAINED_SESSION_COLLECTIONS_CAPABILITY,
  serverHasCapability,
} from "@yep-anywhere/shared";
import { ensureVersionInfo } from "../hooks/useVersion";
import type { ClientSummarySourceKey } from "./clientSummaryStore";

/**
 * Whether a session-collection read asks the server for its retained summaries
 * or for the complete walk.
 */
export type CollectionRequestMode = "retained" | "complete";

export interface CollectionRequestModeOptions {
  /**
   * A text query. Retained rows answer fewer fields than the complete walk, so
   * a search always reads the complete path.
   */
  searchQuery?: string;
  /** The source this caller is on now, read after the version request. */
  currentSourceKey: () => ClientSummarySourceKey;
}

/**
 * Decides how one session-collection request reads, resolving the source's
 * version info first so the capability answer is the connected server's.
 *
 * Throws `Session source changed` when the source moved while that version
 * request was in flight: the mode would describe a server this caller is no
 * longer reading from, and every caller abandons the request on that error.
 */
export async function resolveCollectionRequestMode(
  sourceKey: ClientSummarySourceKey,
  options: CollectionRequestModeOptions,
): Promise<CollectionRequestMode> {
  const version = await ensureVersionInfo(sourceKey);
  if (options.currentSourceKey() !== sourceKey) {
    throw new Error("Session source changed");
  }
  if (options.searchQuery) return "complete";
  return serverHasCapability(version, RETAINED_SESSION_COLLECTIONS_CAPABILITY)
    ? "retained"
    : "complete";
}
