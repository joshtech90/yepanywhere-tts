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

Related: [project templates](../../topics/project-templates.md#limited-user-permissions)
and [limited users](../../topics/limited-users.md).

Contributing-model: 6-Astra.
