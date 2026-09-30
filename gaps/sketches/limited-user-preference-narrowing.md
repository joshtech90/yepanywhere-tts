# Limited users may eventually narrow inherited settings

User direction, 2026-09-28: settings a limited user cannot see take the
superuser's effective configuration. Hiding a setting does not select a
different default. Server-affecting settings generally remain administrator
controlled; explicit per-user grants and locks remain the authority ceiling.

Consider allowing a limited user to turn off some otherwise permitted
features, without enabling anything the administrator disallows. For example,
their chooser could show a subset of the templates the administrator allows.
The administrator's None / Selected / Any template grant is a hard server
restriction; an eventual personal subset would only narrow it.

TBD: eligible settings, persistence and scope, inherited-value presentation,
reset-to-inherited behavior, and behavior when the administrator changes the
allowed set. No personal narrowing UI or new preference storage is approved
by this sketch.

## Per-setting exposure and published defaults beneath own choices

User direction, 2026-09-29, no immediate need: a limited user's settings
view is restricted too coarsely; refine it so they can configure more
themselves. The superuser's published browser defaults may sit beneath a
limited user's own choices for settings they can actually configure.

Today every publish stamps a new revision and each browser applies it once,
overwriting every listed value, including ones the user chose deliberately
([browser defaults](../../topics/limited-users.md#browser-defaults-for-limited-users)).
The settings view is an allowlist of whole categories
(`packages/client/src/lib/limitedUserSettings.ts`), so browser-local
preferences in a hidden category (for example transcript/thinking display,
session scroll and cache options, attachment quality) reach them only
through published defaults.

Agent-derived candidate: classify exposure per setting rather than per
category, showing browser-local preferences wherever they are rendered while
server-affecting controls stay hidden, and keep the forcing effect of a
publish for settings they cannot configure.

TBD: which settings count as browser-local and user-reachable, how a user's
own choice is distinguished from an applied default, and whether the
administrator keeps an explicit "reapply to everyone" action.

Related: [project templates](../../topics/project-templates.md#limited-user-permissions)
and [limited users](../../topics/limited-users.md).

Contributing-model: 6-Astra.
