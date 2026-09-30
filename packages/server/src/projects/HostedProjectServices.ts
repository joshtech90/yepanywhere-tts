import { resolve } from "node:path";
import { z } from "zod";
import {
  getProviderHostStatus,
  requestHostedProjectService,
} from "../sdk/providers/provider-runtime-host.js";
import {
  projectServiceRecordSchema,
  type ProjectServices,
  type ProjectServiceUpstream,
} from "./ProjectServiceManager.js";

const upstreamSchema = z
  .object({
    projectId: z.string(),
    port: z.number().int().min(1).max(65535),
    brokerSocket: z.string(),
    generation: z.string(),
    token: z.string(),
    basePath: z.string(),
    entry: z.string(),
  })
  .nullable();

/** Hono borrows the host's app owner; closing the UI server never stops its apps. */
export class HostedProjectServices implements ProjectServices {
  private ready?: Promise<void>;
  private closed = false;
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
  }

  private async call(
    action: string,
    projectId: string,
    options: Record<string, unknown> = {},
    authorize?: () => Promise<void>,
  ): Promise<unknown> {
    if (this.closed) throw new Error("Project services are shutting down");
    this.ready ??= getProviderHostStatus().then((status) => {
      if (
        !Array.isArray(status.features) ||
        !status.features.includes("project-services")
      )
        throw new Error(
          "Provider host must be restarted to manage project apps",
        );
    });
    await this.ready;
    let authorizationFailure: unknown;
    return requestHostedProjectService(
      { dataDir: this.dataDir, action, projectId, ...options },
      authorize
        ? async () => {
            if (this.closed) throw new Error("App controller is closing");
            try {
              await authorize();
            } catch (error) {
              authorizationFailure = error;
              throw error;
            }
          }
        : undefined,
    ).catch((error: unknown) => {
      throw authorizationFailure ?? error;
    });
  }

  async status(projectId: string) {
    return projectServiceRecordSchema
      .nullable()
      .parse(await this.call("status", projectId));
  }

  async start(
    projectId: string,
    projectPath: string,
    authorize: () => Promise<void>,
    mode: "app" | "live-preview" = "app",
  ) {
    await authorize();
    return projectServiceRecordSchema.parse(
      await this.call("start", projectId, { projectPath, mode }, authorize),
    );
  }

  async stop(projectId: string, authorize: () => Promise<void>) {
    await authorize();
    return projectServiceRecordSchema
      .nullable()
      .parse(await this.call("stop", projectId, {}, authorize));
  }

  async upstream(projectId: string): Promise<ProjectServiceUpstream | null> {
    return upstreamSchema.parse(await this.call("upstream", projectId));
  }

  async upstreamForToken(
    token: string,
  ): Promise<ProjectServiceUpstream | null> {
    return upstreamSchema.parse(await this.call("upstreamForToken", token));
  }

  async ownsLaunch(projectId: string): Promise<boolean> {
    return z.boolean().parse(await this.call("ownsLaunch", projectId));
  }

  async listUpstreams(): Promise<ProjectServiceUpstream[]> {
    return z
      .array(upstreamSchema.unwrap())
      .parse(await this.call("listUpstreams", "all"));
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
