/**
 * Asking each configured model-serving endpoint which thinking efforts it takes.
 *
 * The probe itself is described in `@yep-anywhere/shared`'s
 * `gateway-effort-probe`: one chat request naming an unrecognized effort, whose
 * rejection lists the accepted vocabulary. This module decides when to send it.
 *
 * Both Claude Gateway and CodexOSS read their catalogs on every model-list
 * refresh, so answers are cached and shared between the two providers. The two
 * stages describe different things and are cached apart: the request schema is
 * a property of the endpoint, asked once per base URL, while the chat template
 * is a property of the model, asked once per model the endpoint serves. A
 * schema failure is cached too — for a shorter while — because the common
 * failure is an endpoint that is simply not up, and retrying it on every
 * refresh would stall the model list behind a connect timeout each time.
 */

import {
  advertisedGatewayEffortLevels,
  DEFAULT_GATEWAY_SERVICE_MODEL_LIMIT,
  describedGatewayModelLevels,
  gatewayEffortProbeRequest,
  gatewayTemplateEffortProbeRequest,
  parseGatewayEffortProbe,
  parseGatewayTemplateEffortRejection,
  probeModelIdFromCatalog,
  type EffortLevel,
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
/**
 * Template questions one catalog read keeps open at once. A template that
 * accepts the question runs a completion, so an endpoint serving many
 * undescribed models is asked a few at a time rather than all together.
 */
const TEMPLATE_PROBE_CONCURRENCY = 4;

type EffortAnswer = GatewayEndpointEffortProbe | undefined;

/** One stage's answers by key, cached and de-duplicated while in flight. */
class CachedAnswers {
  private readonly answers = new Map<
    string,
    { expiresAt: number; answer: EffortAnswer }
  >();
  private readonly inFlight = new Map<string, Promise<EffortAnswer>>();

  constructor(
    private readonly now: () => number,
    private readonly ttlMs: (answer: EffortAnswer) => number,
  ) {}

  get(key: string, ask: () => Promise<EffortAnswer>): Promise<EffortAnswer> {
    const cached = this.answers.get(key);
    if (cached && cached.expiresAt > this.now()) {
      return Promise.resolve(cached.answer);
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const attempt = ask()
      .then((answer) => {
        this.set(key, answer);
        return answer;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, attempt);
    return attempt;
  }

  set(key: string, answer: EffortAnswer): void {
    this.answers.set(key, {
      answer,
      expiresAt: this.now() + this.ttlMs(answer),
    });
  }

  copyFrom(other: CachedAnswers): void {
    for (const [key, entry] of other.answers) this.answers.set(key, entry);
  }

  clear(): void {
    this.answers.clear();
  }
}

function endpointKey(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, "");
}

/**
 * Endpoints' and their models' answers, cached and de-duplicated.
 *
 * The schema stage is keyed by base URL rather than by service id: the same
 * endpoint reached through two entries answers identically, and an entry whose
 * URL changed is a different endpoint that must be asked again. The template
 * stage adds the model id to that key.
 */
export class GatewayEffortProbeCache {
  private enabled = true;
  private readonly schemas: CachedAnswers;
  private readonly templates: CachedAnswers;

  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    now: () => number = () => Date.now(),
  ) {
    this.schemas = new CachedAnswers(now, (answer) =>
      answer ? ANSWER_TTL_MS : SILENCE_TTL_MS,
    );
    // Every template outcome stands for the full while. Its failure leaves the
    // schema answer in force rather than silence, and asking again is what
    // costs: the likeliest failure is a template that accepted the question and
    // whose one-token completion is still queued behind real work.
    this.templates = new CachedAnswers(now, () => ANSWER_TTL_MS);
  }

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
    this.schemas.clear();
    this.templates.clear();
  }

  /**
   * Adopt the answers another cache obtained, so an explicit detection also
   * spares the next catalog read a second request to the same endpoint.
   */
  adopt(other: GatewayEffortProbeCache): void {
    this.schemas.copyFrom(other.schemas);
    this.templates.copyFrom(other.templates);
  }

  /**
   * What the endpoint's request schema accepts, or undefined when it has not
   * said.
   *
   * `modelId` only fills the request's required `model` field; the answer
   * describes the endpoint, which is why it is cached without it.
   */
  endpointProbe(baseUrl: string, modelId: string): Promise<EffortAnswer> {
    if (!this.enabled) return Promise.resolve(undefined);
    const endpoint = endpointKey(baseUrl);
    return this.schemas.get(endpoint, () => this.askSchema(endpoint, modelId));
  }

  /**
   * What this model accepts through this endpoint, or undefined when the
   * endpoint has not said.
   *
   * The schema answer narrowed by the model's chat template when the template
   * says so; the schema answer as it stands when it does not, or when asking
   * the template failed.
   */
  async probe(baseUrl: string, modelId: string): Promise<EffortAnswer> {
    const schema = await this.endpointProbe(baseUrl, modelId);
    if (!schema) return undefined;
    const endpoint = endpointKey(baseUrl);
    const narrowed = await this.templates.get(
      JSON.stringify([endpoint, modelId]),
      () => this.askTemplate(endpoint, modelId, schema),
    );
    return narrowed ?? schema;
  }

  private async askSchema(
    baseUrl: string,
    modelId: string,
  ): Promise<EffortAnswer> {
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
      return probe;
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
   * narrowing from the top and the schema answer stands — and when asking it
   * failed, which leaves the schema answer standing too rather than discarding
   * what the first stage already learned.
   */
  private async askTemplate(
    baseUrl: string,
    modelId: string,
    schema: GatewayEndpointEffortProbe,
  ): Promise<EffortAnswer> {
    const highest = schema.levels.at(-1);
    if (!highest) return undefined;
    let body: string;
    try {
      const response = await this.fetchImpl(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dummy",
        },
        body: JSON.stringify(
          gatewayTemplateEffortProbeRequest(modelId, highest),
        ),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (response.ok) return undefined;
      body = await response.text();
    } catch (error) {
      log.debug(
        { error, baseUrl, modelId, asked: highest },
        "Chat template effort probe failed; the schema answer stands",
      );
      return undefined;
    }
    const narrowed = parseGatewayTemplateEffortRejection(body);
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

  const fresh = new GatewayEffortProbeCache(fetchImpl);
  const probe = await fresh.probe(root, modelId);
  gatewayEffortProbeCache.adopt(fresh);
  if (!probe) return { ok: false, reason: "undescribed" };
  return { ok: true, probe, modelId };
}

/**
 * Each listed model's probe answer, given the catalog just read from a service.
 *
 * Both providers call this at the same point: they have the endpoint's real
 * address and its model list, and are about to resolve what each model offers.
 * An entry stating its own levels is not probed at all — configuration wins for
 * every model of that service, so no answer could change the outcome.
 *
 * The chat template is asked only about a model whose levels the answer would
 * supply, because nothing ranked above it describes the model; any other model
 * gets the endpoint's schema answer, which can still say whether thinking can
 * be switched off. `isListed` names the rows the caller will list, so the
 * models asked about are the ones it offers, counted against the same limit.
 */
export async function probeServiceEffort(
  service: Pick<GatewayService, "effortLevels" | "maxModels">,
  baseUrl: string,
  catalogPayload: unknown,
  isListed: (row: unknown, modelId: string) => boolean = () => true,
): Promise<ReadonlyMap<string, GatewayEndpointEffortProbe>> {
  const answers = new Map<string, GatewayEndpointEffortProbe>();
  if (service.effortLevels?.length) return answers;
  const listed = listedCatalogModels(
    catalogPayload,
    service.maxModels ?? DEFAULT_GATEWAY_SERVICE_MODEL_LIMIT,
    isListed,
  );
  const first = listed[0];
  if (!first) return answers;
  const schema = await gatewayEffortProbeCache.endpointProbe(
    baseUrl,
    first.modelId,
  );
  if (!schema) return answers;

  const undescribed: string[] = [];
  for (const { modelId, advertisedLevels } of listed) {
    const described = describedGatewayModelLevels({
      modelId,
      advertisedLevels,
    });
    if (described) answers.set(modelId, schema);
    else undescribed.push(modelId);
  }
  let next = 0;
  const worker = async () => {
    while (next < undescribed.length) {
      const modelId = undescribed[next++]!;
      const answer = await gatewayEffortProbeCache.probe(baseUrl, modelId);
      if (answer) answers.set(modelId, answer);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(TEMPLATE_PROBE_CONCURRENCY, undescribed.length) },
      worker,
    ),
  );
  return answers;
}

/** The distinct rows a caller will list, in catalog order, up to its limit. */
function listedCatalogModels(
  payload: unknown,
  limit: number,
  isListed: (row: unknown, modelId: string) => boolean,
): { modelId: string; advertisedLevels: EffortLevel[] }[] {
  const rows = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const listed: { modelId: string; advertisedLevels: EffortLevel[] }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (listed.length >= limit) break;
    const id = (row as { id?: unknown } | null)?.id;
    const modelId = typeof id === "string" ? id.trim() : "";
    if (!modelId || seen.has(modelId) || !isListed(row, modelId)) continue;
    seen.add(modelId);
    listed.push({
      modelId,
      advertisedLevels: advertisedGatewayEffortLevels(
        row as Parameters<typeof advertisedGatewayEffortLevels>[0],
      ),
    });
  }
  return listed;
}
