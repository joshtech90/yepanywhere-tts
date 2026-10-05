import type {
  ProjectAppAddresses,
  ProjectAppInfo,
  ProjectAppView,
  ProjectAppInventory,
} from "@yep-anywhere/shared";
import { fetchJSON } from "./sourceApiFetch";

export interface ProjectAppTarget {
  target: "app" | "artifact";
  artifactId?: string;
}
const path = (id: string) => `/projects/${encodeURIComponent(id)}/app`;
export const projectAppApi = {
  inventory: () => fetchJSON<ProjectAppInventory>("/project-apps"),
  deleteApp: (id: string) =>
    fetchJSON<{ deleted: boolean }>(path(id), { method: "DELETE" }),
  releaseAddress: (projectId: string, namespace: string) =>
    fetchJSON<unknown>("/project-apps/address/release", {
      method: "POST",
      body: JSON.stringify({ projectId, namespace }),
    }),
  info: (id: string) => fetchJSON<ProjectAppInfo>(path(id)),
  open: (id: string, target: ProjectAppTarget, audience: "local" | "public") =>
    fetchJSON<ProjectAppView>(`${path(id)}/open`, {
      method: "POST",
      body: JSON.stringify({ ...target, audience }),
    }),
  action: (id: string, action: "start" | "stop" | "restore", body = {}) =>
    fetchJSON<unknown>(`${path(id)}/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  addresses: (id: string) =>
    fetchJSON<ProjectAppAddresses>(`${path(id)}/address`),
  addressAction: (
    id: string,
    action: "reserve" | "serve" | "release",
    body: object,
  ) =>
    fetchJSON<unknown>(`${path(id)}/address/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
