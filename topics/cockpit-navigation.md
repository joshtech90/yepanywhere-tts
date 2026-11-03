# Cockpit document links and return navigation

The personal Cockpit transcript opens confirmed project-file links in a
separate browser tab, preserving the session, scroll position and draft.
The existing authenticated file viewer owns access checks and document
rendering, including Markdown and isolated HTML. This does not add a file
grant or execute document scripts on the application origin.

On macOS, explicit new-window HTTP(S) links open in Google Chrome, including
links to the Cockpit's own servers; if Chrome is absent, the default browser
is used. Mailto links use the system handler. Other schemes are not opened
by the native new-window delegate.

The classic navigation shell always displays a visible **Yep Cockpit** link
above the content, on desktop and phone, including standalone file pages.
It returns to the stored Cockpit destination for the same direct/relay base,
or to that base's Cockpit entry when no matching destination is stored.
Public shares do not acquire the authenticated navigation shell.
