import { HTTPException } from "hono/http-exception";
import type { ProjectAppView } from "@yep-anywhere/shared";
import type {
  ProjectAppStore,
  ProjectAppReservation,
} from "../projects/ProjectAppStore.js";
import type {
  ProjectServices,
  ProjectServiceUpstream,
} from "../projects/ProjectServiceManager.js";
import type { ArtifactServer } from "./ArtifactServer.js";
import type { ArtifactConfig } from "./config.js";
import { APP_ACCESS_QUERY, type AppAccessTarget } from "./VhostAccess.js";
import { configuredVhostNames, hostnameFromHostHeader } from "./vhosts.js";
import { proxyLoopbackVhost } from "./vhost-proxy.js";

function appEntry(upstream: ProjectServiceUpstream): string {
  return upstream.basePath
    ? `${upstream.basePath}${upstream.entry.slice(1)}`
    : upstream.entry;
}

/** Project services share the existing isolated listeners, never YA's API origin. */
export class ProjectAppDelivery {
  readonly ready: Promise<void>;
  constructor(
    private readonly artifacts: ArtifactServer,
    private readonly services: ProjectServices,
    private readonly store: ProjectAppStore,
    private readonly staticApp?: (
      projectId: string,
    ) => Promise<{ entry: string; root: string } | null>,
    private readonly publicAllowed?: (
      reservation: ProjectAppReservation,
    ) => Promise<boolean>,
  ) {
    this.ready = this.refreshHosts();
    void this.ready.catch((error: unknown) =>
      console.error("[ProjectAppDelivery] Addresses unavailable:", error),
    );
  }

  async refreshHosts(): Promise<void> {
    const rows = await this.store.allReservations();
    const live = await this.services.listUpstreams();
    this.artifacts.registerProjectHosts([
      ...rows.flatMap((row) => [
        `${row.name}.localhost`,
        `${row.name}.${row.namespace}`,
      ]),
      ...live.flatMap((upstream) => [
        `app-${upstream.token}.localhost`,
        ...(this.artifacts.config.vhostPublicRoot
          ? [`app-${upstream.token}.${this.artifacts.config.vhostPublicRoot}`]
          : []),
      ]),
    ]);
  }

  async validateConfig(config: ArtifactConfig): Promise<void> {
    const rows = await this.store.allReservations();
    if (
      configuredVhostNames(config).some((name) =>
        rows.some((row) => row.name === name),
      )
    )
      throw new Error("A configured app name is reserved by a project");
  }

  async open(
    projectId: string,
    audience: "local" | "public",
  ): Promise<ProjectAppView> {
    await this.ready;
    await this.artifacts.ready;
    const upstream = await this.services.upstream(projectId);
    if (!upstream)
      throw new HTTPException(409, {
        message: "Project service is not running",
      });
    const config = this.artifacts.config;
    const storedReservation = (await this.store.reservations(projectId)).find(
      (row) => row.namespace === config.vhostPublicRoot && row.serving,
    );
    const reserved = storedReservation
      ? await this.effectiveReservation(storedReservation)
      : undefined;
    if (audience === "public" && reserved) {
      return {
        id: `service:${projectId}:${upstream.generation}`,
        kind: "service",
        url: await this.addressLink(reserved),
        label: "Project app",
        transferable: true,
      };
    }
    const origin =
      audience === "local" ? config.localOrigin : config.publicOrigin;
    let url: URL;
    if (upstream.basePath && origin) {
      url = new URL(appEntry(upstream), origin);
    } else {
      const name = `app-${upstream.token}`;
      if (audience === "public") {
        if (!config.vhostPublicRoot)
          throw new HTTPException(409, {
            message:
              "This service needs a public app host, or a basePathEnv declaration and a public artifact origin",
          });
        url = new URL(
          `https://${name}.${config.vhostPublicRoot}${appEntry(upstream)}`,
        );
      } else {
        if (!config.localOrigin)
          throw new HTTPException(409, {
            message: "Local app serving is not configured",
          });
        url = new URL(config.localOrigin);
        url.hostname = `${name}.localhost`;
        url.pathname = appEntry(upstream);
      }
      this.artifacts.registerProjectHosts([url.hostname]);
      url.searchParams.set(
        APP_ACCESS_QUERY,
        this.artifacts.vhostAccess.token({
          name,
          projectId,
          generation: upstream.generation,
        }),
      );
    }
    return {
      id: `service:${projectId}:${upstream.generation}`,
      kind: "service",
      url: url.href,
      label: "Project app",
      transferable: true,
    };
  }

  /** Caller must authorize project access before exposing this transferable link. */
  async addressLink(reservation: ProjectAppReservation): Promise<string> {
    await this.artifacts.ready;
    const url = new URL(
      `https://${reservation.name}.${reservation.namespace}/`,
    );
    if (!reservation.public) {
      url.searchParams.set(
        APP_ACCESS_QUERY,
        this.artifacts.vhostAccess.token({
          name: reservation.name,
          projectId: reservation.projectId,
        }),
      );
    }
    return url.href;
  }

  async effectiveReservation(
    row: ProjectAppReservation,
  ): Promise<ProjectAppReservation> {
    const allowed = this.publicAllowed
      ? await this.publicAllowed(row)
      : !row.privateOnly;
    return { ...row, privateOnly: !allowed, public: row.public && allowed };
  }

  /** Bearer path for base-path-aware apps, under the opaque artifact sandbox. */
  async dispatchPath(
    request: Request,
    token: string,
    proxy = proxyLoopbackVhost,
  ): Promise<Response> {
    await this.ready;
    const upstream = await this.services.upstreamForToken(token);
    if (!upstream?.basePath)
      return new Response("Project app unavailable", { status: 404 });
    const url = new URL(request.url);
    if (!url.pathname.startsWith(upstream.basePath))
      return new Response("Project app unavailable", { status: 404 });
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods":
            "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers":
            request.headers.get("access-control-request-headers") ??
            "Content-Type",
        },
      });
    url.searchParams.delete(APP_ACCESS_QUERY);
    const headers = new Headers(request.headers);
    for (const name of [
      "cookie",
      "authorization",
      "x-desktop-token",
      "referer",
      "x-yep-anywhere",
    ])
      headers.delete(name);
    const incoming = new Request(url, {
      method: request.method,
      headers,
      body: request.body,
      ...(request.body ? { duplex: "half" } : {}),
    });
    const response = await proxy(
      incoming,
      upstream.port,
      undefined,
      upstream.brokerSocket,
    );
    // Opaque-origin app fetches use their scoped bearer path, never cookies.
    response.headers.delete("set-cookie");
    response.headers.delete("access-control-allow-credentials");
    response.headers.set("Access-Control-Allow-Origin", "*");
    return response;
  }

  /** Dedicated hosts retain normal app cookie behavior and existing bearer policy. */
  async dispatchHost(
    request: Request,
    clientAddress?: string,
    proxy = proxyLoopbackVhost,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.dispatchHostResponse(request, clientAddress, proxy);
    } catch (error) {
      // A broken source declaration or missing static build is an unavailable
      // app, not an exception escaping the public listener or a host-path leak.
      console.warn("[ProjectAppDelivery] App unavailable:", error);
      response = new Response("Project app unavailable", { status: 503 });
    }
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  private async dispatchHostResponse(
    request: Request,
    clientAddress?: string,
    proxy = proxyLoopbackVhost,
  ): Promise<Response> {
    await this.ready;
    await this.artifacts.ready;
    if (
      !this.artifacts.config.localOrigin &&
      !this.artifacts.config.vhostPublicRoot
    )
      return new Response("App hosting is disabled", { status: 503 });
    const hostname = hostnameFromHostHeader(
      request.headers.get("host") ?? new URL(request.url).host,
    );
    const namespace = this.artifacts.config.vhostPublicRoot ?? "localhost";
    const storedReservation = (await this.store.allReservations()).find(
      (row) =>
        row.namespace === namespace &&
        (hostname === `${row.name}.localhost` ||
          hostname === `${row.name}.${row.namespace}`),
    );
    const reservation = storedReservation
      ? await this.effectiveReservation(storedReservation)
      : undefined;
    let upstream: ProjectServiceUpstream | null;
    let target: AppAccessTarget;
    if (reservation) {
      if (
        configuredVhostNames(this.artifacts.config).includes(reservation.name)
      )
        return new Response(
          "App address configuration conflicts with a reservation",
          { status: 503 },
        );
      target = {
        name: reservation.name,
        projectId: reservation.projectId,
        public: reservation.public,
      };
      upstream = reservation.serving
        ? await this.services.upstream(reservation.projectId)
        : null;
    } else {
      const match = /^app-([a-f0-9]{48})\./.exec(hostname ?? "");
      upstream = match ? await this.services.upstreamForToken(match[1]!) : null;
      if (!upstream)
        return new Response("Project app unavailable", { status: 503 });
      const localHost = `app-${upstream.token}.localhost`;
      const publicHost = `app-${upstream.token}.${this.artifacts.config.vhostPublicRoot}`;
      if (
        !(this.artifacts.config.localOrigin && hostname === localHost) &&
        !(this.artifacts.config.vhostPublicRoot && hostname === publicHost)
      )
        return new Response("App host is no longer configured", {
          status: 503,
        });
      target = {
        name: `app-${upstream.token}`,
        projectId: upstream.projectId,
        generation: upstream.generation,
      };
    }
    const authorized = this.artifacts.vhostAccess.authorize(request, target);
    if (!authorized) return new Response("App link required", { status: 401 });
    if (!upstream && reservation?.serving && this.staticApp) {
      const app = await this.staticApp(reservation.projectId);
      if (app) {
        const audience = hostname?.endsWith(".localhost") ? "local" : "public";
        const grant = await this.artifacts.createGrant(
          app.entry,
          audience,
          false,
          app.root,
        );
        return new Response(null, {
          status: 302,
          headers: {
            Location: grant.url,
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            ...(authorized.cookie ? { "Set-Cookie": authorized.cookie } : {}),
          },
        });
      }
    }
    if (!upstream)
      return new Response("Project app is not serving", { status: 503 });
    const url = new URL(authorized.request.url);
    let response: Response;
    if (url.pathname === "/" && appEntry(upstream) !== "/") {
      response = new Response(null, {
        status: 302,
        headers: { Location: appEntry(upstream) },
      });
    } else {
      response = await proxy(
        authorized.request,
        upstream.port,
        clientAddress,
        upstream.brokerSocket,
      );
    }
    if (authorized.cookie)
      response.headers.append("Set-Cookie", authorized.cookie);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
}
