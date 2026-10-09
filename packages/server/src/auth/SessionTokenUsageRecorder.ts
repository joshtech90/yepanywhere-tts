/**
 * Attributes provider token charges to the principal whose work caused them,
 * so Settings → Users can say what each user's sessions actually cost.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Usage.
 *
 * Which frame carries a provider's charge is `readBillableUsage`'s to say:
 * per request for Claude and Codex, a turn total for the rest. A streaming
 * Claude response repeats one request's usage on every completed content
 * block, including a subagent's, whose frames interleave with the main
 * thread's. So this accumulates per live process, counts each response id
 * once per turn, and appends when the provider turn settles, rather than one
 * line per frame: a long turn costs a record or two, and the ledger keeps its
 * per-turn granularity.
 *
 * The four token classes stay apart, and requests are binned by context tier,
 * because a cache read is a tenth of a fresh prompt token and, on a provider
 * that has such a tier, a long request reprices the whole request. Only this
 * recorder sees a single request's prompt length, so the tier has to be decided
 * here — a sum cannot be un-summed later. The threshold is per provider, or per
 * model where one has its own, and for a provider with no tier every request
 * is standard. A turn total names no
 * single request, so it is recorded at the standard tier.
 */

import {
  longContextThresholdTokens,
  type UsageTokenClasses,
} from "@yep-anywhere/shared";
import { getProjectName } from "../projects/paths.js";
import { readBillableUsage } from "../sdk/billableUsage.js";
import type { SDKMessage } from "../sdk/types.js";
import type { Process } from "../supervisor/Process.js";

/** What the recorder appends. Kept narrow so tests need no usage service. */
export interface SessionTokenUsageRecord extends UsageTokenClasses {
  username?: string;
  /** Launch alias the session was started with, kept for reference. */
  model?: string;
  /**
   * The model that served these requests, which the report groups by and the
   * price table is keyed by: the frame's own model where it names one, else
   * the session's resolved model.
   */
  modelId?: string;
  project?: string;
  /** Which price list these counts are read under. */
  provider: string;
  /** Whether these requests were in the provider's long-context tier. */
  longContext: boolean;
}

export interface SessionTokenUsageRecorderOptions {
  /** Append a settled charge. Absent on a server built without the ledger. */
  record: (record: SessionTokenUsageRecord) => void;
  /** The principal who started a session; undefined means the superuser. */
  resolveUsername?: (sessionId: string) => string | undefined;
}

interface PendingCharge {
  /** The serving model the frames named; undefined uses the session's. */
  model: string | undefined;
  longContext: boolean;
  classes: UsageTokenClasses;
}

interface PendingTurn {
  /**
   * One accumulator per serving model and context tier, so a subagent's
   * requests on another model are priced at that model.
   */
  charges: Map<string, PendingCharge>;
  /** Responses already counted this turn, so repeated frames add nothing. */
  countedResponseIds: Set<string>;
}

const emptyClasses = (): UsageTokenClasses => ({
  freshInputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
});

export class SessionTokenUsageRecorder {
  private readonly pending = new Map<string, PendingTurn>();

  constructor(private readonly options: SessionTokenUsageRecorderOptions) {}

  observeMessage(process: Process, message: SDKMessage): void {
    const usage = readBillableUsage(message, process.provider);
    if (!usage) return;

    const pending: PendingTurn = this.pending.get(process.id) ?? {
      charges: new Map(),
      countedResponseIds: new Set(),
    };
    if (usage.responseId !== undefined) {
      // A later frame of a counted response repeats its usage, even after
      // another response's frames came between them; counting it again would
      // bill the same request twice.
      if (pending.countedResponseIds.has(usage.responseId)) return;
      pending.countedResponseIds.add(usage.responseId);
    }

    // The tier is the prompt this one request sent, not the turn's running sum,
    // and the threshold is the provider's or model's own — 272k on OpenAI,
    // 100k on Haiku 5.5, none on other Claude models, which price 1M flat.
    const threshold = longContextThresholdTokens(
      process.provider,
      usage.model ?? process.resolvedModel,
    );
    const longContext =
      threshold !== null &&
      usage.requestPromptTokens !== undefined &&
      usage.requestPromptTokens > threshold;
    const key = `${usage.model ?? ""}\u0000${longContext ? 1 : 0}`;
    const charge = pending.charges.get(key) ?? {
      model: usage.model,
      longContext,
      classes: emptyClasses(),
    };
    charge.classes.freshInputTokens += usage.freshInputTokens;
    charge.classes.cachedInputTokens += usage.cachedInputTokens;
    charge.classes.cacheWriteTokens += usage.cacheWriteTokens;
    charge.classes.outputTokens += usage.outputTokens;
    pending.charges.set(key, charge);
    this.pending.set(process.id, pending);
  }

  /** Append whatever this process has accumulated and start over. */
  flush(process: Process): void {
    const pending = this.pending.get(process.id);
    if (!pending) return;
    this.pending.delete(process.id);
    const username = this.options.resolveUsername?.(process.sessionId);
    const identity = {
      ...(username ? { username } : {}),
      ...(process.requestedModel ? { model: process.requestedModel } : {}),
      ...(process.projectPath
        ? { project: getProjectName(process.projectPath) }
        : {}),
      provider: process.provider,
    };
    // Standard tier first, so a mixed turn reads in the order it was priced.
    const charges = [...pending.charges.values()].sort(
      (a, b) => Number(a.longContext) - Number(b.longContext),
    );
    for (const charge of charges) {
      const modelId = charge.model ?? process.resolvedModel;
      this.options.record({
        ...identity,
        ...(modelId ? { modelId } : {}),
        longContext: charge.longContext,
        ...charge.classes,
      });
    }
  }

  /** A process going away still owes its last turn's charge. */
  forgetProcess(process: Process): void {
    this.flush(process);
  }
}
