/**
 * The pre-boot new-session composer, seen from the app.
 *
 * `preboot/new-session-composer.js` puts a focused textarea on screen while
 * the HTML is still parsing, so a tab opened on /new-session is typeable
 * before any module loads. The app either adopts it — NewSessionForm takes
 * its text and caret in the commit that creates the real composer — or, when
 * the route resolves somewhere else first (a login redirect), retires it and
 * keeps what was typed for the composer that mounts after sign-in.
 * See topics/early-typing-handoff.md.
 */

const OVERLAY_ID = "yep-preboot-composer";
const SHOWN_ATTRIBUTE = "data-preboot-composer";
const STASH_KEY = "yep-preboot-composer-text";

export interface PrebootComposerText {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** True when this document opened with the pre-boot composer on screen. */
export function prebootComposerShown(): boolean {
  return document.documentElement.hasAttribute(SHOWN_ATTRIBUTE);
}

/** True when this pathname is the route the pre-boot composer stands in for. */
export function isNewSessionPathname(pathname: string): boolean {
  return /(?:^|\/)new-session\/?$/.test(pathname);
}

function removeOverlay(): PrebootComposerText | null {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return null;
  const textarea = overlay.querySelector("textarea");
  overlay.remove();
  if (!textarea) return null;
  return {
    text: textarea.value,
    selectionStart: textarea.selectionStart,
    selectionEnd: textarea.selectionEnd,
  };
}

function readStash(): string {
  try {
    const text = sessionStorage.getItem(STASH_KEY) ?? "";
    sessionStorage.removeItem(STASH_KEY);
    return text;
  } catch {
    return "";
  }
}

/**
 * Remove the pre-boot composer and hand over what it holds: the overlay's
 * text and caret, or text stashed when it was retired earlier. Null when
 * there is nothing to adopt.
 */
export function takePrebootComposer(): PrebootComposerText | null {
  const live = removeOverlay();
  if (live) return live;
  const text = readStash();
  return text
    ? { text, selectionStart: text.length, selectionEnd: text.length }
    : null;
}

/**
 * The app is showing something other than the new-session composer. Get the
 * overlay out of its way and keep any typed text for a later adoption in this
 * tab.
 */
export function retirePrebootComposer(): void {
  const taken = removeOverlay();
  if (!taken?.text) return;
  try {
    sessionStorage.setItem(STASH_KEY, taken.text);
  } catch {
    // Storage unavailable: the text is lost, as it would be on any page.
  }
}
