/**
 * App-wide record of modified keypresses, so shortcuts can tell a held
 * modifier from one still down after a just-finished chord.
 *
 * Fast typing rolls one chord into the next key: "Ctrl+V, Space" with Space
 * pressed before Ctrl is up arrives as Space with ctrlKey set, which raw
 * modifier state cannot tell from Ctrl+Space. Within one modifier hold, a key
 * pressed after an earlier chord key is judged by the gap since that key's
 * release:
 *
 * - under MODIFIER_COOLDOWN_MS, or before that release, the modifier is spent;
 * - at or past MODIFIER_DELIBERATE_HOLD_MS, it applies;
 * - in between, it applies unless the modifier is released before the key.
 *
 * A key that starts a fresh hold always gets the modifier, whatever the
 * release order. All times are the events' own timestamps, so a busy main
 * thread delivering a burst late does not shrink the gaps.
 */

export const MODIFIER_COOLDOWN_MS = 50;
export const MODIFIER_DELIBERATE_HOLD_MS = 300;

export interface Modifiers {
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type ModifierName = keyof Modifiers;

export interface ModifiedKey {
  key: string;
  code: string;
  /** Modifiers the keyboard reported as down. */
  modifiers: Modifiers;
  downAt: number;
  releasedAt: number | null;
}

type Verdict = "applies" | "spent" | "pending";

const MODIFIER_BY_KEY: Record<string, ModifierName> = {
  Control: "ctrlKey",
  Alt: "altKey",
  Meta: "metaKey",
  Shift: "shiftKey",
};
const MODIFIER_NAMES: ModifierName[] = [
  "ctrlKey",
  "altKey",
  "metaKey",
  "shiftKey",
];
const NON_CHORD_KEYS = new Set(["AltGraph", "CapsLock", "Fn", "OS"]);

interface PendingSettlement {
  code: string;
  modifier: ModifierName;
  settle: (applies: boolean) => void;
}

interface ChordState {
  /** Last key pressed under each modifier's current hold. */
  heldFor: Partial<Record<ModifierName, ModifiedKey>>;
  last: ModifiedKey | null;
  verdicts: WeakMap<Event, Partial<Record<ModifierName, Verdict>>>;
  pending: PendingSettlement[];
}

let state: ChordState | null = null;

/** Starts tracking on `window`; returns a function that stops it. */
export function installModifierChordTracking(): () => void {
  if (state) return () => {};
  const tracked: ChordState = {
    heldFor: {},
    last: null,
    verdicts: new WeakMap(),
    pending: [],
  };
  state = tracked;
  const onKeyDown = (event: KeyboardEvent) => noteKeyDown(tracked, event);
  const onKeyUp = (event: KeyboardEvent) => noteKeyUp(tracked, event);
  // Keyups that land in another window never arrive here.
  const onBlur = () => {
    tracked.heldFor = {};
    settleWhere(tracked, () => true, false);
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
    if (state === tracked) state = null;
  };
}

/**
 * Reports whether `modifier` genuinely applies to a keydown: synchronously
 * when the timing decides it, else when the key or the modifier is released,
 * whichever comes first. Without tracking, or for an event tracking never
 * saw, this is the reported modifier state.
 */
export function settleModifier(
  event: KeyboardEvent,
  modifier: ModifierName,
  settle: (applies: boolean) => void,
): void {
  const verdict = state?.verdicts.get(event)?.[modifier];
  if (!state || !verdict) {
    settle(event[modifier]);
    return;
  }
  if (verdict === "pending") {
    state.pending.push({ code: keyCode(event), modifier, settle });
    return;
  }
  settle(verdict === "applies");
}

/** The most recent keypress made with any modifier reported down. */
export function lastModifiedKey(): ModifiedKey | null {
  return state?.last ?? null;
}

function keyCode(event: KeyboardEvent): string {
  return event.code || event.key;
}

function judge(earlier: ModifiedKey | undefined, at: number): Verdict {
  if (!earlier) return "applies";
  if (earlier.releasedAt === null) return "spent";
  const gap = at - earlier.releasedAt;
  if (gap < MODIFIER_COOLDOWN_MS) return "spent";
  if (gap >= MODIFIER_DELIBERATE_HOLD_MS) return "applies";
  return "pending";
}

function noteKeyDown(tracked: ChordState, event: KeyboardEvent): void {
  const modifier = MODIFIER_BY_KEY[event.key];
  if (modifier) {
    if (!event.repeat) delete tracked.heldFor[modifier];
    return;
  }
  if (NON_CHORD_KEYS.has(event.key) || event.repeat) return;
  const code = keyCode(event);
  const verdicts: Partial<Record<ModifierName, Verdict>> = {};
  const pressed: ModifiedKey = {
    key: event.key,
    code,
    modifiers: {
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    },
    downAt: event.timeStamp,
    releasedAt: null,
  };
  for (const name of MODIFIER_NAMES) {
    if (!event[name]) {
      delete tracked.heldFor[name];
      continue;
    }
    verdicts[name] = judge(tracked.heldFor[name], event.timeStamp);
    tracked.heldFor[name] = pressed;
  }
  tracked.verdicts.set(event, verdicts);
  if (Object.keys(verdicts).length > 0) tracked.last = pressed;
}

function noteKeyUp(tracked: ChordState, event: KeyboardEvent): void {
  const modifier = MODIFIER_BY_KEY[event.key];
  if (modifier) {
    delete tracked.heldFor[modifier];
    settleWhere(tracked, (pending) => pending.modifier === modifier, false);
    return;
  }
  const code = keyCode(event);
  for (const name of MODIFIER_NAMES) {
    const held = tracked.heldFor[name];
    if (held?.code === code && held.releasedAt === null) {
      held.releasedAt = event.timeStamp;
    }
  }
  if (tracked.last?.code === code && tracked.last.releasedAt === null) {
    tracked.last.releasedAt = event.timeStamp;
  }
  settleWhere(tracked, (pending) => pending.code === code, true);
}

function settleWhere(
  tracked: ChordState,
  matches: (pending: PendingSettlement) => boolean,
  applies: boolean,
): void {
  const settled = tracked.pending.filter(matches);
  if (settled.length === 0) return;
  tracked.pending = tracked.pending.filter((pending) => !matches(pending));
  for (const pending of settled) pending.settle(applies);
}
