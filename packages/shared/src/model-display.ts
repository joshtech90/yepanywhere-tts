/**
 * A model id as people read it: the served id without the vendor name the
 * provider already implies, so `claude-opus-5-5` shows as `opus-5-5`.
 *
 * Display only. Records and price lookups keep the full id, because the same
 * model reached through another harness or gateway may bill differently and
 * must stay distinguishable there.
 */
export function displayModelId(model: string): string {
  return model.replace(/^claude-/u, "");
}
