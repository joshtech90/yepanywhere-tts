# Interactive artifact links have no revocation management UI

Interactive HTML artifact links expire automatically, and stopping or closing
their preview revokes them. The authenticated `DELETE /api/artifacts/:id`
route also revokes a known grant, but there is no owner-facing inventory or
manual revocation pane. A user cannot inspect outstanding artifact links and
revoke one from Settings.

Add authenticated grant inventory and revocation controls when needed, reusing
the public-share inventory presentation where appropriate. Artifact grants
authorize an HTML directory on a separate origin and have their own lifecycle;
they must not be mislabeled as public session or live file shares. Any new
inventory route needs its own supported-server compatibility review.

The maintainer explicitly deferred this UI while requesting configurable expiry.
The serving and lifetime contract is in
[Active Content Security](../topics/active-content-security.md).

Found 2026-09-07 while adding the interactive artifact expiry setting.
