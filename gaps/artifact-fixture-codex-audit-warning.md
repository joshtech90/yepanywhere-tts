# Artifact fixture startup reports an installed Codex audit mismatch

The isolated YA servers started by `artifact-host/acceptance.mjs` warn that the
installed Codex CLI is 0.160.1 while `package.json` names audited target 0.163.0.
The diagnostic explicitly says this is advisory and that Codex app-server
behavior may differ if its protocol changed. Both slow-link runs retain it in
their private server logs.

Those runs use generated Claude transcripts and do not launch a Codex session;
their artifact/SRP observations do not qualify this older Codex app-server.
Keep the diagnostic intact. Align a separately owned test CLI with the audited
version, or qualify the installed version before using that provider in a live
fixture. Updating the user's global CLI or weakening the production audit is
outside the Android artifact transport investigation, so it was not changed.
No provider executable/version was spoofed to silence startup.

Found 2026-10-17 while reproducing native artifact slow-link queue pressure.
