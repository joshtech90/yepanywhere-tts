import {
  publishRendezUserTurn as publish,
  type RendezUserTurn,
} from "./rendez-activity.mjs";
import { getLogger } from "../logging/logger.js";

type RendezUserTurnListener = (projectPath: string) => void;

const listeners = new Set<RendezUserTurnListener>();

/** Observe actual user turns, which are what may attach a project's watcher. */
export function onRendezUserTurn(listener: RendezUserTurnListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Publish actual user activity independently of the optional filesystem watcher. */
export function publishRendezUserTurn(turn: RendezUserTurn): void {
  publish(turn, (error) => {
    getLogger().warn(
      { projectPath: turn.projectPath, error: error.message },
      "Rendez latest-session publication failed",
    );
  });
  // After publication, so a watcher this turn attaches replays the turn.
  for (const listener of listeners) listener(turn.projectPath);
}
