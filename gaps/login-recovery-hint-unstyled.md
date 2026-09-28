# The direct login page's password-recovery hint has no style

`LoginPage` (`packages/client/src/pages/LoginPage.tsx`) renders the
"Forgot your password?" hint with class `login-recovery-hint`, which no
stylesheet defines; its sibling `login-hint` is styled in
`packages/client/src/styles/index.css`. The hint therefore renders in the
browser's default body size and color, larger and darker than every other line
on the page (captured at 1000×600 and 375×812 during F54 of the harsh-review
fixes).

Not fixed in place because the page's styles all live in the frozen global
`index.css`; a fix belongs in a new `LoginPage.module.css` that takes the
page's `login-*` rules with it, which is a CSS-ownership slice rather than
part of hiding the Username field. Cheap interim fix: give the hint the
`login-hint` treatment.

Found 2026-09-26 while fixing the harsh-review item that hides the limited-user
Username field.
