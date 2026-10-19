# Android Chrome's native spelling popup hides the keyboard

Reported and reproduced 2026-10-13 on the attached physical Pixel 7a with
Chrome 154.0.8037.126. The trigger is a single tap on a word with an actual
red spelling squiggle, not ordinary text selection or Backspace. The user
reproduced it with `gdvv` / `hdcjkfd` in the owned session fixture. Tapping the
marked word opens Chrome's native spelling menu and hides Gboard before an
edit occurs.

This is browser behavior, independently reproduced in a plain HTML textarea
with no YA application scripts. Native Gboard typing of `Gdvv ` produced a
squiggle; a single tap opened the same spelling menu and hid the keyboard.
The textarea remained `document.activeElement` and `document.hasFocus()`
stayed true. The app reproduction likewise retained the exact same connected
textarea and emitted no blur, focusout or explicit `HTMLElement.blur()` call
around the tap. Its visual viewport grew from 476.95 to 813.33 CSS pixels;
the plain control grew from 476.95 to 789.33. Android reported the IME hidden
while its served input connection remained present.

Chromium's native SuggestionsPopupWindow is focusable and configured with
`PopupWindow.INPUT_METHOD_NOT_NEEDED`:
https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/public/android/java/src/org/chromium/content/browser/input/SuggestionsPopupWindow.java
The observed keyboard closure is consistent with that native popup policy;
it is not evidence of a YA selection handler blurring/remounting the editor.

Workaround verified on the plain control: dismiss the spelling menu, then
long-press the red-underlined word. That opens normal Cut/Copy selection and
restores the keyboard. Ordinary long-press selection plus Gboard Backspace
also passed in the app composer. The spelling popup itself offers replacement
suggestions and Delete, which do not require the keyboard.

No YA runtime change was made. Keep native spelling and deliberate keyboard
closure intact; do not force focus or disable spellchecking by default to mask
this browser behavior. Any future workaround needs its own explicit product
choice and native-popup evidence. Local reviewed screenshots and traces are
under `tasks/android-typo-focus/`, including
`app-popup-confirmed-trace.json`, `plain-popup-trace.json`, and the paired
capture manifest in `spelling-popup-presented/`. The test session remains
running at the user's request.

Found 2026-10-13 while investigating a user-reported Android typo correction.
