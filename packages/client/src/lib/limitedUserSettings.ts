/**
 * Which settings categories a limited user can actually use.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Settings → Users.
 *
 * Every server-settings write is 403 for a limited principal, and whole route
 * families behind these panes are denied outright, so most categories are
 * either inert or never finish loading for them — Local Access waits forever
 * on `/api/network-binding`, which a limited user may not call.
 *
 * This is an allowlist for the same reason the server's route policy is: a
 * category added later is hidden from limited users until someone lists it
 * deliberately, rather than quietly shipping them a broken pane.
 */
const LIMITED_USER_SETTINGS_CATEGORIES: ReadonlySet<string> = new Set([
  // Browser-local presentation, which is genuinely theirs.
  "appearance",
  "toolbar",
  "message-delivery",
  // Push lives on their own device; subscribe/unsubscribe are self-writes.
  "notifications",
  // Their own account: username, grants, lock, and Log out.
  "users",
  "about",
]);

/** Whether a limited user may open this settings category. */
export function limitedUserMaySeeSettingsCategory(id: string): boolean {
  return LIMITED_USER_SETTINGS_CATEGORIES.has(id);
}
