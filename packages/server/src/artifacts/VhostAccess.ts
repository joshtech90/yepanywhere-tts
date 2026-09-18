import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactVhost } from "./vhosts.js";

const COOKIE = "ya_app_access";
export const APP_ACCESS_QUERY = "ya_access";

/** Durable, app-scoped bearer links. Restart never rotates credentials. */
export class VhostAccess {
  readonly ready: Promise<void>;
  private secret = randomBytes(32);
  private generations: Record<string, number> = {};
  private writing = Promise.resolve();
  constructor(private readonly directory?: string) {
    this.ready = this.load();
  }
  private async load() {
    if (!this.directory) return;
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, "app-access.key");
    const staging = `${path}.${randomUUID()}`;
    await writeFile(staging, this.secret, { flag: "wx", mode: 0o600 });
    try {
      await link(staging, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await unlink(staging);
    }
    this.secret = await readFile(path);
    if (this.secret.length !== 32)
      throw new Error("Invalid persisted app access key");
    try {
      const value: unknown = JSON.parse(
        await readFile(join(this.directory, "app-access.json"), "utf8"),
      );
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !Object.values(value).every(
          (entry) => Number.isSafeInteger(entry) && Number(entry) >= 0,
        )
      )
        throw new Error("Invalid persisted app access generations");
      this.generations = value as Record<string, number>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  private generation(name: string): number {
    return Object.hasOwn(this.generations, name) ? this.generations[name]! : 0;
  }
  token(row: ArtifactVhost): string {
    return createHmac("sha256", this.secret)
      .update(
        JSON.stringify([
          "vhost-access-v1",
          row.name,
          row.port,
          this.generation(row.name),
        ]),
      )
      .digest("base64url");
  }
  async rotate(row: ArtifactVhost) {
    await this.ready;
    const operation = this.writing.then(async () => {
      const next = {
        ...this.generations,
        [row.name]: this.generation(row.name) + 1,
      };
      if (this.directory) {
        const file = join(this.directory, "app-access.json");
        // Unique per write: two instances over one directory would otherwise
        // stage to the same name and the loser's rename fails with ENOENT.
        const staging = `${file}.${process.pid}.${randomUUID()}`;
        try {
          await writeFile(staging, JSON.stringify(next), { mode: 0o600 });
          await rename(staging, file);
        } catch (error) {
          await unlink(staging).catch(() => {});
          throw error;
        }
      }
      this.generations = next;
    });
    this.writing = operation;
    await operation;
  }
  /** Validate the URL bearer or a host-only cookie; never pass either upstream. */
  authorize(
    request: Request,
    row: ArtifactVhost,
  ): { request: Request; cookie?: string } | null {
    const url = new URL(request.url);
    const bearer = url.searchParams.get(APP_ACCESS_QUERY);
    const cookies = (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim());
    const cookie = cookies
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    const supplied = bearer ?? cookie;
    const expected = this.token(row);
    if (
      !row.public &&
      (!supplied ||
        Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)))
    )
      return null;
    // Public vhosts terminate HTTPS at the tunnel; the listener sees HTTP.
    const browserOrigin = url.hostname.endsWith(".localhost")
      ? url.origin
      : `https://${url.host}`;
    if (
      !row.public &&
      !bearer &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers.get("origin") !== browserOrigin
    )
      return null;
    url.searchParams.delete(APP_ACCESS_QUERY);
    const headers = new Headers(request.headers);
    const otherCookies = cookies.filter(
      (part) =>
        part &&
        ![COOKIE, "yep-anywhere-session", "yep-anywhere-desktop-session"].some(
          (name) => part.startsWith(`${name}=`),
        ),
    );
    if (otherCookies.length) headers.set("cookie", otherCookies.join("; "));
    else headers.delete("cookie");
    headers.delete("referer");
    headers.delete("x-desktop-token");
    headers.delete("authorization");
    return {
      request: new Request(url, {
        method: request.method,
        headers,
        body: request.body,
        ...(request.body ? { duplex: "half" } : {}),
      }),
      ...(bearer && !row.public
        ? {
            cookie: `${COOKIE}=${expected}; Path=/; HttpOnly; SameSite=None; Secure`,
          }
        : {}),
    };
  }
}
