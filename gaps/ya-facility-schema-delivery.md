# Preserve schema delivery if a future sandbox restricts reads

This is a conditional follow-up, not a demonstrated defect under the current
broad-read sandbox. Trigger it if YA adopts a sandbox that restricts reads and
thereby prevents a harness from reading a needed schema. Future vendored
`~/agents` facilities may need it; YA currently ships no such skill bundle.
The repo-local publish skill is a local fixture source.

Ordinary announced schema files can use the authenticated project file API:
the workflow client resolves an absolute or home-relative pointer through the
connected source's `/projects/:projectId/files/raw` route. Its allow-set includes
the Local Access custom path lines. The request runs in YA's server, outside
the harness sandbox, and does not require the harness to print file contents.
With the present broad-read sandbox this is sufficient for the client; no
additional schema-specific access mechanism is required merely for viewing.

If the trigger occurs, preserve access through YA's server even when the
harness cannot open the path. Prefer the existing authenticated file route
where it is sufficient; otherwise provide an authorized declaration to the
client or inline it into activity metadata without rewriting canonical tool
output. Any extra access should be limited to the intended files, not a general
escape from the sandbox. Test a real harness-denied schema, a permitted YA-side
read, an unrelated denied path, and correct remote-source routing. Keep file
access and instruction execution authority separate.

Related contracts: [workflow view](../topics/workflow-view.md),
[session sandboxing](../topics/session-sandboxing.md), and
[the harness-read gap](sandbox-harness-instruction-read-access.md).

Found 2026-09-07 while correcting workflow schema-file activation tests.
Contributing-model: 6-Astra
