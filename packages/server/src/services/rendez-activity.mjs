import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { subscribe } from "./rendez-protocol.mjs";

const latest = new Map();
const running = new Set();

/** Coalesce user activity per project without holding up session input. */
export function publishRendezUserTurn(turn, onError) {
  const prior = latest.get(turn.projectPath);
  if (prior && prior.turn.receivedAt > turn.receivedAt) return;
  latest.delete(turn.projectPath);
  latest.set(turn.projectPath, { turn, onError });
  if (latest.size > 128) latest.delete(latest.keys().next().value);
  flushRendezUserTurn(turn.projectPath);
}

/** Replay activity accepted before an opt-in watcher created its destination. */
export function flushRendezUserTurn(projectPath) {
  const entry = latest.get(projectPath);
  if (!entry || running.has(projectPath)) return;
  running.add(projectPath);
  recordUserTurn(entry.turn)
    .catch(entry.onError)
    .finally(() => {
      running.delete(projectPath);
      // A newer turn that arrived meanwhile is recorded next.
      if (latest.get(projectPath) !== entry) flushRendezUserTurn(projectPath);
    });
}

async function recordUserTurn(turn) {
  let root;
  try {
    root = join(await realpath(turn.projectPath), ".rendez");
    const stats = await lstat(root);
    if (stats.isSymbolicLink()) {
      throw new Error("Rendez root must not be a symlink");
    }
    if (!stats.isDirectory()) return;
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  await subscribe(
    root,
    {
      harness: turn.harness,
      providerSessionId: turn.providerSessionId,
      yaSessionId: turn.sessionId,
      liveOnly: true,
    },
    { latest: true, receivedAt: turn.receivedAt },
  );
}
