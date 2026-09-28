import type { TranscriptDisplayObject } from "@yep-anywhere/shared";
import type { RenderItem } from "@yep-anywhere/shared/transcript/items";
import { getEarliestMessageTimestampMs, parseTimestampMs } from "./messageAge";
import type { Message } from "../types";
import { getCachedWebTranscriptProjection } from "./webTranscriptProjection";

/** Anchor a bang command to displayed content, never a transient result event. */
export function getBangCommandAnchor(messages: Message[]): string {
  const items = getCachedWebTranscriptProjection(messages);
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const sources = items[index]?.sourceMessages ?? [];
    for (
      let sourceIndex = sources.length - 1;
      sourceIndex >= 0;
      sourceIndex -= 1
    ) {
      const message = sources[sourceIndex];
      const id = message?.uuid ?? message?.id;
      if (id) return id;
    }
  }
  return "";
}

export function insertTranscriptDisplayObjects(
  items: RenderItem[],
  objects: readonly TranscriptDisplayObject[],
  recoverUnanchoredBangCommands = false,
): RenderItem[] {
  if (objects.length === 0) {
    return items;
  }

  const placements = objects.flatMap((object, order) => {
    // An empty anchor places the object before the first item (empty-session
    // runs); a non-empty anchor must match a loaded message or the object is
    // omitted until its anchor is in the window.
    if (object.placementAfterMessageId === "") {
      return [{ itemIndex: -1, object, order }];
    }
    let itemIndex = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (
        item?.sourceMessages.some(
          (message) =>
            (message.uuid ?? message.id) === object.placementAfterMessageId,
        )
      ) {
        itemIndex = index;
      }
    }
    // Older clients anchored runs to transient result events. On the live
    // window, recover those records by creation time without mutating history.
    if (
      itemIndex === Number.NEGATIVE_INFINITY &&
      recoverUnanchoredBangCommands &&
      object.kind === "bang-command"
    ) {
      const createdAt = parseTimestampMs(object.createdAt);
      if (createdAt !== null) {
        for (let index = 0; index < items.length; index += 1) {
          const timestamp = getEarliestMessageTimestampMs(
            items[index]?.sourceMessages ?? [],
          );
          if (timestamp !== null && timestamp <= createdAt) itemIndex = index;
        }
      }
    }
    return itemIndex === Number.NEGATIVE_INFINITY
      ? []
      : [{ itemIndex, object, order }];
  });
  placements.sort(
    (left, right) =>
      right.itemIndex - left.itemIndex || right.order - left.order,
  );
  if (placements.length === 0) {
    return items;
  }

  const result = [...items];
  for (const placement of placements) {
    result.splice(placement.itemIndex + 1, 0, {
      type: "transcript_display_object",
      id: placement.object.id,
      object: placement.object,
      sourceMessages: [],
    });
  }
  return result;
}
