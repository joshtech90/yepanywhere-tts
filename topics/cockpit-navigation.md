# Cockpit document links and return navigation

The personal Cockpit transcript opens confirmed project-file and local-file links in a
separate browser tab, preserving the session, scroll position and draft.
The existing authenticated file viewer owns access checks and document
rendering, including Markdown and isolated HTML. Local-file links use the
same viewer with the exact absolute path and current project context; direct
and relay links retain their owning source base. This does not add a file
grant or execute document scripts on the application origin.

On macOS, document links and external HTTP(S) links open in Google Chrome;
if Chrome is absent, the default browser is used. Internal app pages such as
settings stay in the native WebView, preserving their app-local preferences.
Mailto links use the system handler. Other external schemes are not opened
by the native new-window delegate.

If the external browser needs a fresh login, successful authentication returns
to the complete requested viewer URL, including its file query and fragment.
Authentication credentials, principals and server-side file grants are unchanged.

The classic navigation shell always displays a visible **Yep Cockpit** link
above the content, on desktop and phone, including standalone file pages.
It returns to the stored Cockpit destination for the same direct/relay base,
or to that base's Cockpit entry when no matching destination is stored.
Public shares do not acquire the authenticated navigation shell.
