/** Optional source-server diagnostic, not a session-discovery capability. */
export interface SqliteStatus {
  state: "disabled" | "unsupported" | "ready" | "error";
  /**
   * Names the network filesystem, such as `NFS`, when storage was refused
   * because the data directory sits on one. Absent for every other `error`,
   * for every other state, and on servers too old to report it, so a client
   * that cannot see this field simply shows no placement advice.
   */
  networkFilesystem?: string;
}
