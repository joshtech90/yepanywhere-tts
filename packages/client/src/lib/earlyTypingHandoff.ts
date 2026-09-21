/**
 * Early typing handoff — keys struck between asking for a typing target and
 * that target holding focus.
 *
 * A navigation whose point is to leave the user typing (reverse search, a
 * prefilled composer, a rename field) cannot always produce the field in the
 * same tick: it may wait on a route change or a session load. Anything typed
 * in that window otherwise reaches whatever still holds focus, which in YA
 * usually means a single-key shortcut rather than the text the user meant.
 *
 * So the requesting side starts a handoff, the keys are held here, and the
 * field claims them when it exists. Retirement waits for evidence rather than
 * a timer: the field must hold focus *and* already show everything taken so
 * far, otherwise a key typed into it would report a value missing those
 * characters and overwrite them. Because a field that rewrites what it is
 * given would never agree, the wait is bounded and the escape repairs the
 * caret instead of hanging on.
 *
 * This deliberately takes printable keys and Backspace only, and only for the
 * span of one request. It is not a general keystroke recorder.
 */

/** One accepted key, as the owning field should apply it. */
export type EarlyTypingKey = { insert: string } | { backspace: true };

/** The field that will own the keys, described by what it can answer. */
export interface EarlyTypingSink {
  /** True while the field owns the keyboard. */
  hasFocus(): boolean;
  /** What the field shows right now. */
  shows(): string;
  /** What it should show once every accepted key has been applied. */
  expects(): string;
  /** Apply one key to whatever state the field renders. */
  applyKey(key: EarlyTypingKey): void;
  /**
   * Place the caret after a handoff that ended without agreement, so the next
   * key appends rather than landing where the field's own rewrite left it.
   */
  repairCaret?(): void;
}

export interface EarlyTypingHandoffOptions {
  /**
   * Focus plus this many keys. A field that disagrees about its own text
   * still takes the keys rather than leaving the handoff in front of it.
   */
  attempts?: number;
  /**
   * Give up if nobody claims the keys. Without this an abandoned navigation
   * would intercept typing for the rest of the page's life.
   */
  expireMs?: number;
}

export interface EarlyTypingHandoff {
  /** True while keys are still being intercepted. */
  active(): boolean;
  /** Characters accepted so far, for a field that claims late. */
  buffered(): string;
  /** Give the keys an owner, replaying what was buffered in order. */
  claim(sink: EarlyTypingSink): void;
  /** Retire if the sink holds focus and already shows what it expects. */
  retireWhenReady(): void;
  /** Stop intercepting and forget; safe to call repeatedly. */
  cancel(): void;
}

const DEFAULT_ATTEMPTS = 2;
const DEFAULT_EXPIRE_MS = 15_000;

function accepted(event: KeyboardEvent): EarlyTypingKey | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === "Backspace") return { backspace: true };
  return event.key.length === 1 ? { insert: event.key } : null;
}

function applyToText(text: string, key: EarlyTypingKey): string {
  return "backspace" in key ? text.slice(0, -1) : text + key.insert;
}

/**
 * Begin holding keys for a typing target. Pass the sink when the field
 * already exists (reverse search opening its own panel); omit it when the
 * field is still on its way (a navigation to a prefilled composer) and call
 * `claim` once it is there.
 */
export function startEarlyTypingHandoff(
  sink?: EarlyTypingSink,
  {
    attempts = DEFAULT_ATTEMPTS,
    expireMs = DEFAULT_EXPIRE_MS,
  }: EarlyTypingHandoffOptions = {},
): EarlyTypingHandoff {
  let owner = sink ?? null;
  let held = "";
  let attempted = 0;
  let listener: ((event: KeyboardEvent) => void) | null = null;
  let expiry: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (expiry !== null) {
      clearTimeout(expiry);
      expiry = null;
    }
    if (!listener) return;
    window.removeEventListener("keydown", listener, true);
    listener = null;
  };

  const ready = () => {
    if (!owner?.hasFocus()) return false;
    if (owner.shows() === owner.expects()) return true;
    attempted += 1;
    return attempted >= attempts;
  };

  const retireWhenReady = () => {
    if (!listener || !ready()) return;
    const retiring = owner;
    cancel();
    if (retiring && retiring.shows() !== retiring.expects()) {
      retiring.repairCaret?.();
    }
  };

  listener = (event: KeyboardEvent) => {
    // Decided per key rather than on a timer: once the field owns this event
    // there is nothing left to hold, and everything struck before it was
    // taken here, so no key falls between the two owners.
    retireWhenReady();
    if (!listener) return;
    const key = accepted(event);
    if (!key) return;
    event.preventDefault();
    event.stopPropagation();
    if (owner) owner.applyKey(key);
    else held = applyToText(held, key);
  };
  window.addEventListener("keydown", listener, true);
  if (expireMs > 0 && !owner) {
    expiry = setTimeout(cancel, expireMs);
  }

  return {
    active: () => listener !== null,
    buffered: () => held,
    claim: (next: EarlyTypingSink) => {
      if (!listener) return;
      if (expiry !== null) {
        clearTimeout(expiry);
        expiry = null;
      }
      owner = next;
      attempted = 0;
      for (const character of held) next.applyKey({ insert: character });
      held = "";
      retireWhenReady();
    },
    retireWhenReady,
    cancel,
  };
}
