import { homedir } from "node:os";
import { resolve } from "node:path";

export function expandHomePath(requestedPath: string): string {
  if (requestedPath === "~") {
    return homedir();
  }
  if (requestedPath.startsWith("~/") || requestedPath.startsWith("~\\")) {
    return resolve(homedir(), requestedPath.slice(2));
  }
  return requestedPath;
}
