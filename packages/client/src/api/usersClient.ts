import type {
  ActingPrincipal,
  LimitedUserLock,
  LimitedUserSummary,
  UsageReport,
} from "@yep-anywhere/shared";
import { fetchJSON } from "./sourceApiFetch";

/** Fields the superuser may set when creating or editing a limited user. */
export interface LimitedUserDraft {
  username?: string;
  password?: string;
  newSessionProjects?: string[];
  joinProjects?: string[];
  viewProjects?: string[];
  joinStaleOffsetMinutes?: number;
  lock?: LimitedUserLock;
  /** Directory the user may create projects under; empty revokes the grant. */
  projectRoot?: string;
  disabled?: boolean;
}

/** Limited users: topics/limited-users.md § Delivery v1. */
export const usersApi = {
  /** Who this client is acting as, and what that principal may do. */
  getActingPrincipal: () => fetchJSON<ActingPrincipal>("/users/me"),

  listUsers: () =>
    fetchJSON<{ users: LimitedUserSummary[]; enabled: boolean }>("/users"),

  /** Per-principal usage totals, superuser only. */
  getUserUsage: () => fetchJSON<UsageReport>("/users/usage"),

  createUser: (draft: LimitedUserDraft) =>
    fetchJSON<{ user: LimitedUserSummary }>("/users", {
      method: "POST",
      body: JSON.stringify(draft),
    }),

  updateUser: (username: string, draft: LimitedUserDraft) =>
    fetchJSON<{ user: LimitedUserSummary }>(
      `/users/${encodeURIComponent(username)}`,
      { method: "PATCH", body: JSON.stringify(draft) },
    ),

  deleteUser: (username: string) =>
    fetchJSON<{ success: boolean }>(`/users/${encodeURIComponent(username)}`, {
      method: "DELETE",
    }),

  /** Act as a limited user, or pass null to return to the superuser. */
  switchUser: (username: string | null) =>
    fetchJSON<{ success: boolean; username: string | null }>("/users/switch", {
      method: "POST",
      body: JSON.stringify({ username }),
    }),

  /** End the acting identity; the reply says where this client should go. */
  logoutUser: () =>
    fetchJSON<{
      success: boolean;
      redirect: "relay-login" | "direct-login" | "stay";
    }>("/users/logout", { method: "POST" }),
};
