# Public session shares do not reliably serve linked project files

Intended behavior (owner direction, 2026-10-15): by default a session share
lets its viewers open everything the transcript shows as viewable — user
attachments, agent-viewed images, and project path links — with a server
setting to turn file access off.

Current behavior authorizes a file only when the session text *mentions* it
in a recognized shape (`collectPublicShareMentionedProjectFiles()` in
`packages/server/src/routes/public-shares.ts`), so a rendered link and the
serving rule can disagree (see `gaps/public-share-extensionless-file-links.md`
for one confirmed case). There is no setting either way.

Reported but not yet reproduced: on kzahel's yepanywhere.com shares, project
relative links do not open for graehl as a viewer. Possibly a server setting on
that instance, possibly the mention-scan disagreement; diagnose against a
real share before changing the rule. Widening authorization is
security-relevant, so it needs its own commit and reasoning in
`topics/relay-origin-and-share-gating.md`.

Found 2026-10-15 while fixing public-share attachment thumbnails.
