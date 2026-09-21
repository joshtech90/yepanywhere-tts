/** Whether an unknown value is a plain keyed object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The same value as a plain keyed object, or null when it is not one. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
