import {
  PUSH_INTENTS,
  PUSH_TARGET_KINDS,
  type PushIntent,
  type PushTarget,
} from "./types.js";
import { hasAsciiControlCharacter } from "./ascii.js";

const MAX_TARGET_LENGTH = 4096;

export function parsePushTarget(value: unknown): PushTarget | undefined {
  if (!isExactRecord(value, ["provider", "kind", "value"])) {
    return undefined;
  }
  if (value.provider !== "fcm") return undefined;
  if (
    typeof value.kind !== "string" ||
    !PUSH_TARGET_KINDS.includes(
      value.kind as (typeof PUSH_TARGET_KINDS)[number],
    )
  ) {
    return undefined;
  }
  if (
    typeof value.value !== "string" ||
    value.value.length < 1 ||
    value.value.length > MAX_TARGET_LENGTH ||
    value.value.trim() !== value.value ||
    hasAsciiControlCharacter(value.value)
  ) {
    return undefined;
  }

  return {
    provider: value.provider,
    kind: value.kind as PushTarget["kind"],
    value: value.value,
  };
}

export function parseInstallationBody(
  value: unknown,
): { target: PushTarget } | undefined {
  if (!isExactRecord(value, ["target"])) return undefined;
  const target = parsePushTarget(value.target);
  return target ? { target } : undefined;
}

export function parseNotificationBody(
  value: unknown,
):
  | { intent: PushIntent; sessionId?: string; eventId?: string; test?: boolean }
  | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some(
      (key) => !["intent", "sessionId", "eventId", "test"].includes(key),
    )
  )
    return undefined;
  for (const key of ["sessionId", "eventId"]) {
    if (
      row[key] !== undefined &&
      (typeof row[key] !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(row[key] as string))
    )
      return undefined;
  }
  if (row.test !== undefined && row.test !== true) return undefined;
  if (
    typeof row.intent !== "string" ||
    !PUSH_INTENTS.includes(row.intent as PushIntent)
  ) {
    return undefined;
  }
  return {
    intent: row.intent as PushIntent,
    ...(row.sessionId === undefined
      ? {}
      : { sessionId: row.sessionId as string }),
    ...(row.eventId === undefined ? {} : { eventId: row.eventId as string }),
    ...(row.test === undefined ? {} : { test: true }),
  };
}

function isExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    keys.every((key) => expectedKeys.includes(key))
  );
}
