/**
 * Stable opener recognizing historical YA post-compact continuation turns. Transcript
 * projection hides user rows that start with this line so the replay is
 * model-visible and not painted as a user bubble.
 */
export const POST_COMPACT_REPLAY_PREAMBLE =
  "This session is being continued after compaction (Yep Anywhere replay).";

export function isPostCompactReplayText(
  text: string | null | undefined,
): boolean {
  if (!text) return false;
  return text.trimStart().startsWith(POST_COMPACT_REPLAY_PREAMBLE);
}
