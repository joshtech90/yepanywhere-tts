import { join } from "node:path";

/** Deterministic before seeding: specs also use these paths at module import. */
export function defaultProfilePaths(tempDir: string) {
  const testDir = join(tempDir, "sessions");
  return {
    tempDir,
    testDir,
    claudeSessionsDir: join(testDir, "claude", "projects"),
    codexSessionsDir: join(testDir, "codex", "sessions"),
    geminiSessionsDir: join(testDir, "gemini", "tmp"),
    dataDir: join(testDir, "yep-anywhere"),
    portFile: join(tempDir, "port"),
    maintenancePortFile: join(tempDir, "maintenance-port"),
    pidFile: join(tempDir, "pid"),
    remoteClientPortFile: join(tempDir, "remote-port"),
    remoteClientPidFile: join(tempDir, "remote-pid"),
    remotePreviewPortFile: join(tempDir, "remote-preview-port"),
    remotePreviewPidFile: join(tempDir, "remote-preview-pid"),
    relayPortFile: join(tempDir, "relay-port"),
    relayPidFile: join(tempDir, "relay-pid"),
  };
}
