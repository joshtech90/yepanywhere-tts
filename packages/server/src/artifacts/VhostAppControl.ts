import { randomUUID } from "node:crypto";
import {
  type ListenerIdentity,
  identifySignallableListener,
  portListenerControlAvailable,
  stopIdentifiedListener,
} from "../utils/portListener.js";
import type { ArtifactVhost } from "./vhosts.js";

export const vhostAppControlAvailable = portListenerControlAvailable;

interface Listener extends ListenerIdentity {
  port: number;
  token: string;
}

/** Only a previously observed, same-user listener may be signalled. */
export class VhostAppControl {
  private listeners = new Map<string, Listener>();
  constructor(private readonly getVhosts: () => readonly ArtifactVhost[]) {}

  private row(name: string) {
    if (!vhostAppControlAvailable)
      throw new Error("App process control is unavailable on this host");
    const row = this.getVhosts().find((entry) => entry.name === name);
    if (!row) throw new Error("App vhost is no longer configured");
    return row;
  }

  async identify(name: string): Promise<{ token: string | null }> {
    const { port } = this.row(name);
    const identity = await identifySignallableListener(port);
    if (identity === null) {
      this.listeners.delete(name);
      return { token: null };
    }
    const previous = this.listeners.get(name);
    if (
      previous?.pid === identity.pid &&
      previous.start === identity.start &&
      previous.port === port
    )
      return { token: previous.token };
    const listener = { ...identity, port, token: randomUUID() };
    this.listeners.set(name, listener);
    return { token: listener.token };
  }

  async stop(name: string, token: string | null): Promise<void> {
    const { port } = this.row(name);
    const observed = this.listeners.get(name);
    const current = await this.identify(name);
    if (current.token === null) return;
    if (
      !token ||
      !observed ||
      observed.token !== token ||
      current.token !== token ||
      observed.port !== port
    )
      throw new Error(
        "App listener changed; reopen the app before trying again",
      );
    if (await stopIdentifiedListener(port, observed)) {
      this.listeners.delete(name);
      return;
    }
    throw new Error("App did not stop after SIGTERM");
  }
}
