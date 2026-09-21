import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayService } from "@yep-anywhere/shared";
import { ClaudeGatewayProvider } from "../../../src/sdk/providers/claude-gateway.js";

/**
 * The launcher is where a service child is spawned and signalled, so these
 * tests replace it: what is under test is which owned children a restart hands
 * over, not how one is started. Each fake owns a process group id the way a
 * launcher that started its service as a foreground child does.
 */
const { launchers, FakeLauncher } = vi.hoisted(() => {
  class FakeLauncher {
    ownedProcessGroupId: number | undefined;
    readonly relinquished: number[] = [];

    async configure(): Promise<void> {}

    async shutdown(): Promise<void> {}

    getOwnedProcessGroupId(): number | undefined {
      return this.ownedProcessGroupId;
    }

    relinquishOwnedProcessGroup(processGroupId: number): boolean {
      if (this.ownedProcessGroupId !== processGroupId) return false;
      this.ownedProcessGroupId = undefined;
      this.relinquished.push(processGroupId);
      return true;
    }
  }
  return { launchers: [] as FakeLauncher[], FakeLauncher };
});

vi.mock(
  "../../../src/sdk/providers/claude-gateway-launcher.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../src/sdk/providers/claude-gateway-launcher.js")
      >();
    class TrackedLauncher extends FakeLauncher {
      constructor() {
        super();
        launchers.push(this);
      }
    }
    return {
      ...actual,
      ClaudeGatewayLauncher: TrackedLauncher,
      claudeGatewayLauncher: new FakeLauncher(),
    } as unknown as typeof actual;
  },
);

function service(id: string, port: number): GatewayService {
  return {
    id,
    label: id,
    shortName: id,
    url: `http://127.0.0.1:${port}`,
    serviceCommand: `${id}-server`,
    enabled: true,
    autoStop: false,
    autoStopAfterSeconds: 0,
    codexEnabled: false,
    codexWireApi: "responses",
  };
}

/** Two services, each owning the foreground child its launcher started. */
async function twoOwnedServices(
  firstPid: number,
  secondPid: number,
): Promise<
  [InstanceType<typeof FakeLauncher>, InstanceType<typeof FakeLauncher>]
> {
  await ClaudeGatewayProvider.configureGatewayServices({
    services: [service("vllm-a", 8001), service("vllm-b", 8002)],
    defaultServiceId: "vllm-a",
  });
  const [first, second] = launchers;
  if (!first || !second) throw new Error("both services need a launcher");
  first.ownedProcessGroupId = firstPid;
  second.ownedProcessGroupId = secondPid;
  return [first, second];
}

describe("owned gateway process groups", () => {
  beforeEach(() => {
    launchers.length = 0;
  });

  afterEach(async () => {
    await ClaudeGatewayProvider.configureGatewayServices({ services: [] });
    ClaudeGatewayProvider.forgetGatewayCatalog();
  });

  it("hands over every service's child, not only the first", async () => {
    const [first, second] = await twoOwnedServices(4321, 8765);
    const handedOver: number[] = [];

    const retentions =
      await ClaudeGatewayProvider.retainOwnedGatewayProcessGroups(
        (processGroupId) => {
          handedOver.push(processGroupId);
        },
      );

    expect(handedOver).toEqual([4321, 8765]);
    expect(retentions).toEqual([
      { processGroupId: 4321, relinquished: true },
      { processGroupId: 8765, relinquished: true },
    ]);
    expect(first.relinquished).toEqual([4321]);
    expect(second.relinquished).toEqual([8765]);
    expect(first.getOwnedProcessGroupId()).toBeUndefined();
    expect(second.getOwnedProcessGroupId()).toBeUndefined();
  });

  it("keeps a child whose handoff failed and hands over the rest", async () => {
    const [first, second] = await twoOwnedServices(4321, 8765);
    const failure = new Error("runtime host refused the process group");

    const retentions =
      await ClaudeGatewayProvider.retainOwnedGatewayProcessGroups(
        (processGroupId) => {
          if (processGroupId === 4321) throw failure;
        },
      );

    expect(retentions).toEqual([
      { processGroupId: 4321, error: failure, relinquished: false },
      { processGroupId: 8765, relinquished: true },
    ]);
    // Still owned here, so the caller's own stop path reaches it.
    expect(first.getOwnedProcessGroupId()).toBe(4321);
    expect(first.relinquished).toEqual([]);
    expect(second.getOwnedProcessGroupId()).toBeUndefined();
  });

  it("reports nothing when no service owns a child", async () => {
    await ClaudeGatewayProvider.configureGatewayServices({
      services: [service("vllm-a", 8001)],
      defaultServiceId: "vllm-a",
    });

    await expect(
      ClaudeGatewayProvider.retainOwnedGatewayProcessGroups(() => {
        throw new Error("nothing to hand over");
      }),
    ).resolves.toEqual([]);
  });
});
