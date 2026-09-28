/** Bytes with an optional binary K/M/G/T suffix, e.g. `256M`. */
export function parseByteSize(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const match = /^\s*(\d+(?:\.\d+)?)\s*([kmgt])?(?:i?b)?\s*$/i.exec(value);
  if (!match) throw new Error(`Invalid byte size: ${value}`);
  const scale = { k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };
  const suffix = match[2]?.toLowerCase() as keyof typeof scale | undefined;
  const bytes = Number(match[1]) * (suffix ? scale[suffix] : 1);
  if (!Number.isFinite(bytes) || bytes < 0)
    throw new Error(`Invalid byte size: ${value}`);
  return Math.floor(bytes);
}
