import { randomUUID } from "node:crypto";
import { type Socket, createConnection } from "node:net";
import type { Context } from "hono";
import { PRINCIPAL_VARIABLE } from "../auth/principal.js";
import { hasCredentialProof } from "../middleware/auth.js";
import type { AgentSession } from "../sdk/providers/types.js";

/** Deliberately nonserializable: request JSON and persisted launch settings
 * cannot recreate credential provenance after restart or a provider-host hop. */
export interface DesktopControlOrigin {
  readonly launch: string;
}
const origins = new WeakSet<DesktopControlOrigin>();
export function desktopControlOrigin(
  context: Context,
): DesktopControlOrigin | undefined {
  if (
    !hasCredentialProof(context) ||
    context.get(PRINCIPAL_VARIABLE)?.kind !== "superuser"
  )
    return undefined;
  const origin = Object.freeze(
    Object.defineProperty({} as DesktopControlOrigin, "launch", {
      value: randomUUID(),
    }),
  );
  origins.add(origin);
  return origin;
}
export function isDesktopControlOrigin(
  value: DesktopControlOrigin | undefined,
): boolean {
  return value !== undefined && origins.has(value);
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
export class NativeMachineControl {
  private readonly pending = new Map<string, Pending>();
  private bytes = Buffer.alloc(0);
  private closed = false;
  private proxy?: string;
  private readonly ready: Promise<void>;
  constructor(private readonly socket: Socket) {
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close();
        reject(new Error("Native desktop handoff timed out"));
      }, 5000);
      this.pending.set("ready", {
        resolve: () => {
          resolve();
        },
        reject,
        timer,
      });
    });
    socket.on("data", (bytes: Buffer) => {
      this.bytes = Buffer.concat([this.bytes, bytes]);
      if (this.bytes.length > 8192) {
        this.close();
        return;
      }
      while (true) {
        const newline = this.bytes.indexOf(10);
        if (newline < 0) break;
        const line = this.bytes.subarray(0, newline);
        this.bytes = this.bytes.subarray(newline + 1);
        try {
          const value = JSON.parse(line.toString()) as Record<string, unknown>;
          if (!this.proxy) {
            if (
              value.protocol !== 1 ||
              typeof value.proxy !== "string" ||
              !/^\/tmp\/ya-mc-[A-Za-z0-9]+\/control\.sock$/.test(value.proxy)
            )
              throw new Error("Invalid native desktop handoff");
            this.proxy = value.proxy;
            this.finish("ready", value);
          } else if (typeof value.request_id === "string")
            this.finish(value.request_id, value);
          else throw new Error("Invalid native desktop reply");
        } catch {
          this.close();
        }
      }
    });
    socket.on("error", () => this.close());
    socket.on("close", () => this.close());
  }
  private finish(id: string, value: Record<string, unknown>) {
    const pending = this.pending.get(id);
    if (!pending) {
      this.close();
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(value);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Native desktop delegation ended"));
    }
    this.pending.clear();
  }
  async pathname(): Promise<string> {
    await this.ready;
    if (this.closed || !this.proxy)
      throw new Error("Native desktop delegation unavailable");
    return this.proxy;
  }
  private async command(
    operation: "register" | "remove" | "profile",
    sessionId?: string,
    generation?: string,
    pid?: number,
  ) {
    await this.pathname();
    if (this.pending.size >= 64)
      throw new Error("Native desktop delegation busy");
    const requestId = randomUUID();
    const reply = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close();
      }, 5000);
      this.pending.set(requestId, { resolve, reject, timer });
    });
    this.socket.write(
      `${JSON.stringify({ operation, request_id: requestId, session_id: sessionId, generation, ...(pid === undefined ? {} : { pid }) })}\n`,
    );
    const value = await reply;
    if (value.accepted !== true)
      throw new Error("Native desktop launch registration denied");
    return value;
  }
  async enabled(): Promise<boolean> {
    return (await this.command("profile")).enabled === true;
  }
  async bind(session: AgentSession, sessionId: string, generation: string) {
    if (!("pid" in session))
      throw new Error("Provider does not expose a native process identity");
    let removed = false;
    let registration: Promise<void> | undefined;
    const register = () => {
      registration ??= (async () => {
        const deadline = performance.now() + 10000;
        while (!removed) {
          const pid =
            typeof session.pid === "function" ? session.pid() : session.pid;
          if (Number.isInteger(pid) && (pid ?? 0) > 1) {
            await this.command("register", sessionId, generation, pid);
            if (removed)
              throw new Error("Native desktop session ended during launch");
            return;
          }
          if (performance.now() >= deadline)
            throw new Error("Provider did not expose a live native process");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error("Native desktop session ended before launch");
      })();
      return registration;
    };
    // Eager providers can register now. Lazy providers expose their actual PID
    // only after iteration starts; no proxy connection is admitted before it.
    const pid = typeof session.pid === "function" ? session.pid() : session.pid;
    if (Number.isInteger(pid) && (pid ?? 0) > 1) await register();
    const remove = async () => {
      if (removed) return;
      removed = true;
      try {
        await this.command("remove", sessionId, generation);
      } catch {
        this.close();
      }
    };
    const iterator = session.iterator;
    const abort = session.abort.bind(session);
    session.iterator = (async function* () {
      if (removed)
        throw new Error("Native desktop session ended before launch");
      // Start the existing provider once, preserving lazy placement and order.
      const first = iterator.next();
      void first.catch(() => {}); // Still awaited below; registration may fail first.
      try {
        await register();
        const value = await first;
        if (!value.done) {
          yield value.value;
          yield* iterator;
        }
      } catch (error) {
        await remove();
        await abort();
        throw error;
      } finally {
        await remove();
      }
    })();
    session.abort = async () => {
      await remove();
      await abort();
    };
    // Detached owners cannot retain automatic desktop authority after the
    // replaceable server relinquishes their launch/provenance channel.
    const detach = session.detachForServerReload?.bind(session);
    if (detach)
      session.detachForServerReload = async () => {
        await remove();
        await detach();
      };
  }
}

let native: NativeMachineControl | undefined;
export function nativeMachineControl(): NativeMachineControl | undefined {
  return native;
}

/** This path is public metadata, not a token. The native listener authenticates
 * the kernel PID/start time of its exact sealed bundled-server launch. A fresh
 * Node/Bun socket uses close-on-exec, rather than inheriting an open descriptor. */
export async function initializeNativeMachineControl(pathname: string) {
  if (
    process.platform !== "darwin" ||
    !process.versions.bun ||
    !/^\/tmp\/ya-mc-[A-Za-z0-9]+\/server\.sock$/.test(pathname)
  )
    throw new Error("Unsupported native desktop handoff");
  const connection = new NativeMachineControl(createConnection(pathname));
  await connection.pathname();
  native = connection;
}
