/**
 * Asking each configured model-serving endpoint which thinking efforts it takes.
 *
 * The probe itself is described in `@yep-anywhere/shared`'s
 * `gateway-effort-probe`: one chat request naming an unrecognized effort, whose
 * rejection lists the accepted vocabulary. This module decides when to send it.
 *
 * Both Claude Gateway and CodexOSS read their catalogs on every model-list
 * refresh, and a probe answer is a property of the endpoint rather than of the
 * read, so answers are cached per endpoint and shared between the two
 * providers. A failure is cached too — for a shorter while — because the common
 * failure is an endpoint that is simply not up, and retrying it on every
 * refresh would stall the model list behind a connect timeout each time.
 */

import {
  gatewayEffortProbeRequest,
  gatewayTemplateEffortProbeRequest,
  parseGatewayEffortProbe,
  parseGatewayTemplateEffortRejection,
  probeModelIdFromCatalog,
  type GatewayEndpointEffortProbe,
  type GatewayService,
} from "@yep-anywhere/shared";
import { getLogger } from "../logging/logger.js";

const log = getLogger().child({ component: "gateway-effort-probe" });

/** How long an answer stands before the endpoint is asked again. */
const ANSWER_TTL_MS = 30 * 60 * 1000;
/** How long a refusal to answer stands. Shorter: the endpoint may be starting. */
const SILENCE_TTL_MS = 60 * 1000;
const PROBE_TIMEOUT_MS = 5000;

interface CachedProbe {
  expiresAt: number;
  probe: GatewayEndpointEffortProbe | undefined;
}

/**
 * One endpoint's answer, cached and de-duplicated.
 *
 * Keyed by base URL rather than by service id: the same endpoint reached
 * through two entries answers identically, and an entry whose URL changed is a
 * different endpoint that must be asked again.
 */
export class GatewayEffortProbeCache {
  private enabled = true;
  private readonly answers = new Map<string, CachedProbe>();
  private readonly inFlight = new Map<
    string,
    Promise<GatewayEndpointEffortProbe | undefined>
  >();

  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Whether YA asks endpoints about effort at all.
   *
   * Default on: an endpoint that describes itself should not need the levels
   * typed in by hand. Turning it off leaves configuration, catalog rows, and
   * the built-in families as the only sources, which is what YA did before.
   */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.forget();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Drop every cached answer, e.g. because the services list changed. */
  forget(): void {
    this.answers.clear();
  }

  /**
   * Adopt an answer obtained elsewhere, so an explicit detection also spares
   * the next catalog read a second request to the same endpoint.
   */
  remember(baseUrl: string, probe: GatewayEndpointEffortProbe): void {
    this.answers.set(baseUrl.replace(/\/+$/u, ""), {
      probe,
      expiresAt: this.now() + ANSWER_TTL_MS,
    });
  }

  /**
   * What this endpoint accepts, or undefined when it has not said.
   *
   * `modelId` only fills the request's required `model` field; the answer
   * describes the endpoint's request schema, which is why it is cached without
   * it. An endpoint that validates per model would need this reconsidered.
   */
  async probe(
    baseUrl: string,
    modelId: string,
  ): Promise<GatewayEndpointEffortProbe | undefined> {
    if (!this.enabled) return undefined;
    const key = baseUrl.replace(/\/+$/u, "");
    const cached = this.answers.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.probe;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const attempt = this.ask(key, modelId)
      .then((probe) => {
        this.answers.set(key, {
          probe,
          expiresAt: this.now() + (probe ? ANSWER_TTL_MS : SILENCE_TTL_MS),
        });
        return probe;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, attempt);
    return attempt;
  }

  private async ask(
    baseUrl: string,
    modelId: string,
  ): Promise<GatewayEndpointEffortProbe | undefined> {
    try {
      const response = await this.fetchImpl(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dummy",
        },
        body: JSON.stringify(gatewayEffortProbeRequest(modelId)),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      // A 2xx means the endpoint accepted a value it should not recognize, so
      // it validates nothing and has told us nothing. It also means the probe
      // produced its one token of output; that is the cost of asking a server
      // that does not validate, and the answer is cached either way.
      if (response.ok) {
        log.debug(
          { baseUrl, modelId },
          "Endpoint accepted an unrecognized effort; nothing learned",
        );
        return undefined;
      }
      const probe = parseGatewayEffortProbe(await response.text());
      log.debug(
        { baseUrl, modelId, status: response.status, probe },
        "Endpoint effort probe answered",
      );
      if (!probe) return undefined;
      return (await this.askTemplate(baseUrl, modelId, probe)) ?? probe;
    } catch (error) {
      log.debug({ error, baseUrl, modelId }, "Endpoint effort probe failed");
      return undefined;
    }
  }

  /**
   * Narrow a schema answer to what the model's chat template actually takes.
   *
   * Request validation and the chat template disagree on a vLLM server serving
   * a model whose template distinguishes fewer levels than the schema admits:
   * the schema accepted all seven while the template took only low, medium and
   * xhigh, so every menu entry the schema stage produced above xhigh failed the
   * user's turn. Asking with the schema's highest level settles it, and the
   * rejection names the default too.
   *
   * Returns undefined when the template said nothing — which includes
   * accepting the value, since a template that takes the top level is not
   * narrowing from the top and the schema answer stands.
   */
  private async askTemplate(
    baseUrl: string,
    modelId: string,
    schema: GatewayEndpointEffortProbe,
  ): Promise<GatewayEndpointEffortProbe | undefined> {
    const highest = schema.levels.at(-1);
    if (!highest) return undefined;
    const response = await this.fetchImpl(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer dummy",
      },
      body: JSON.stringify(gatewayTemplateEffortProbeRequest(modelId, highest)),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (response.ok) return undefined;
    const narrowed = parseGatewayTemplateEffortRejection(await response.text());
    if (!narrowed) return undefined;
    log.debug(
      { baseUrl, modelId, asked: highest, narrowed },
      "Chat template narrowed the endpoint's effort vocabulary",
    );
    // The template describes the model YA is about to run, so its answer
    // replaces the schema's entirely, "none" included: a schema that validates
    // "none" against a template that does not list it would only buy a turn
    // that fails the same way the levels above xhigh did.
    return narrowed;
  }
}

export const gatewayEffortProbeCache = new GatewayEffortProbeCache();

/** Why an explicit detection could not answer, for a message the user reads. */
export type GatewayEffortDetectionFailure =
  | "unreachable"
  | "no-models"
  | "undescribed";

export type GatewayEffortDetection =
  | { ok: true; probe: GatewayEndpointEffortProbe; modelId: string }
  | { ok: false; reason: GatewayEffortDetectionFailure };

/**
 * Ask an endpoint about effort right now, on the user's explicit request.
 *
 * Bypasses both the cache and the default-on setting: pressing the button in
 * the services editor means asking this endpoint as it is now, including after
 * restarting it with a different model, and it should work while automatic
 * detection is switched off.
 */
export async function detectEndpointEffort(
  baseUrl: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<GatewayEffortDetection> {
  const root = baseUrl.replace(/\/+$/u, "");
  let modelId: string | undefined;
  try {
    const response = await fetchImpl(`${root}/v1/models`, {
      headers: { Authorization: "Bearer dummy" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "unreachable" };
    modelId = probeModelIdFromCatalog(await response.json());
  } catch (error) {
    log.debug(
      { error, baseUrl: root },
      "Effort detection could not read models",
    );
    return { ok: false, reason: "unreachable" };
  }
  if (!modelId) return { ok: false, reason: "no-models" };

  const probe = await new GatewayEffortProbeCache(fetchImpl).probe(
    root,
    modelId,
  );
  if (!probe) return { ok: false, reason: "undescribed" };
  gatewayEffortProbeCache.remember(root, probe);
  return { ok: true, probe, modelId };
}

/**
 * One service's probe answer, given the catalog just read from it.
 *
 * Both providers call this at the same point: they have the endpoint's real
 * address and its model list, and are about to resolve what each model offers.
 * An entry stating its own levels is not probed at all — configuration wins for
 * every model of that service, so no answer could change the outcome.
 */
export async function probeServiceEffort(
  service: Pick<GatewayService, "effortLevels">,
  baseUrl: string,
  catalogPayload: unknown,
): Promise<GatewayEndpointEffortProbe | undefined> {
  if (service.effortLevels?.length) return undefined;
  const modelId = probeModelIdFromCatalog(catalogPayload);
  if (!modelId) return undefined;
  return gatewayEffortProbeCache.probe(baseUrl, modelId);
}
