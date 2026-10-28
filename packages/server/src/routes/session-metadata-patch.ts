import {
  PROMPT_SUGGESTION_MODES,
  type PromptSuggestionMode,
  clampRecapAfterSeconds,
  normalizeSidebarCategory,
} from "@yep-anywhere/shared";

export interface SessionMetadataPatch {
  title?: string;
  archived?: boolean;
  starred?: boolean;
  /** Normalized category name; null files the session under no category. */
  sidebarCategory?: string | null;
  parentSessionId?: string | null;
  wakeTurnsEnabled?: boolean | null;
  promptSuggestionMode?: PromptSuggestionMode | null;
  recapAfterSeconds?: number | null;
}

interface SessionMetadataPatchBody {
  title?: string;
  archived?: boolean;
  starred?: boolean;
  sidebarCategory?: unknown;
  parentSessionId?: string | null;
  wakeTurnsEnabled?: unknown;
  promptSuggestionMode?: unknown;
  recapAfterSeconds?: unknown;
}

type ParseSessionMetadataPatchResult =
  | {
      ok: true;
      patch: SessionMetadataPatch;
    }
  | {
      ok: false;
      status: 400 | 410;
      error: string;
    };

function metadataPatchBody(body: unknown): SessionMetadataPatchBody {
  return typeof body === "object" && body !== null
    ? (body as SessionMetadataPatchBody)
    : {};
}

function invalidPatch(error: string): ParseSessionMetadataPatchResult {
  return { ok: false, status: 400, error };
}

export function parseSessionMetadataPatch(
  rawBody: unknown,
): ParseSessionMetadataPatchResult {
  const body = metadataPatchBody(rawBody);
  if (Object.keys(body).some((key) => key.startsWith("heartbeat"))) {
    return {
      ok: false,
      status: 410,
      error: "Synthetic heartbeat turns have been removed",
    };
  }

  // At least one field must be provided.
  if (
    body.title === undefined &&
    body.archived === undefined &&
    body.starred === undefined &&
    body.sidebarCategory === undefined &&
    body.parentSessionId === undefined &&
    body.wakeTurnsEnabled === undefined &&
    body.promptSuggestionMode === undefined &&
    body.recapAfterSeconds === undefined
  ) {
    return invalidPatch("At least one session metadata field must be provided");
  }

  if (
    body.wakeTurnsEnabled !== undefined &&
    body.wakeTurnsEnabled !== null &&
    typeof body.wakeTurnsEnabled !== "boolean"
  ) {
    return invalidPatch("wakeTurnsEnabled must be a boolean or null");
  }
  if (
    body.parentSessionId !== undefined &&
    body.parentSessionId !== null &&
    typeof body.parentSessionId !== "string"
  ) {
    return invalidPatch("parentSessionId must be a string or null");
  }

  let sidebarCategory: string | null | undefined;
  if (body.sidebarCategory !== undefined) {
    if (body.sidebarCategory === null) {
      sidebarCategory = null;
    } else if (typeof body.sidebarCategory === "string") {
      sidebarCategory = normalizeSidebarCategory(body.sidebarCategory);
    } else {
      return invalidPatch("sidebarCategory must be a string or null");
    }
  }

  const parentSessionId =
    body.parentSessionId === undefined
      ? undefined
      : typeof body.parentSessionId === "string"
        ? body.parentSessionId.trim() || null
        : null;

  // promptSuggestionMode: null/"" clears the preference (revert to default);
  // a valid enum value is stored; any other value is rejected.
  let promptSuggestionMode: PromptSuggestionMode | null | undefined;
  if (body.promptSuggestionMode !== undefined) {
    if (
      body.promptSuggestionMode === null ||
      body.promptSuggestionMode === ""
    ) {
      promptSuggestionMode = null;
    } else if (
      typeof body.promptSuggestionMode === "string" &&
      PROMPT_SUGGESTION_MODES.includes(
        body.promptSuggestionMode as PromptSuggestionMode,
      )
    ) {
      promptSuggestionMode = body.promptSuggestionMode as PromptSuggestionMode;
    } else {
      return invalidPatch("promptSuggestionMode must be one of: off, native");
    }
  }

  let recapAfterSeconds: number | null | undefined;
  if (body.recapAfterSeconds !== undefined) {
    if (body.recapAfterSeconds === null || body.recapAfterSeconds === "") {
      recapAfterSeconds = null;
    } else if (
      typeof body.recapAfterSeconds === "number" &&
      Number.isFinite(body.recapAfterSeconds)
    ) {
      recapAfterSeconds = clampRecapAfterSeconds(body.recapAfterSeconds);
    } else {
      return invalidPatch("recapAfterSeconds must be null or a finite number");
    }
  }

  return {
    ok: true,
    patch: {
      title: body.title,
      archived: body.archived,
      starred: body.starred,
      sidebarCategory,
      parentSessionId,
      wakeTurnsEnabled: body.wakeTurnsEnabled as boolean | null | undefined,
      promptSuggestionMode,
      recapAfterSeconds,
    },
  };
}
