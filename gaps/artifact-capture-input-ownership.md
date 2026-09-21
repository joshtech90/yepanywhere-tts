# Failed artifact capture can delete its caller's input bundle

`packages/client/scripts/artifact-capture.ts` creates a grant with
`owned: options.ownArtifact !== false`. The command accepts an existing HTML
bundle, but its default ownership permits grant cleanup to remove that input.
During project-template mockup review, failed interaction assertions revoked
their grants and the existing `.artifacts/mockups/project-templates` directory
disappeared. Other successful grants for that same bundle then lost their files.
The fixture source was unaffected and rebuilding recovered the generated bundle.

The comment claims the capture command wrote the published directory; the CLI
instead receives a caller-owned bundle and writes captures to a separate output
directory. It also does not expose the `ownArtifact: false` API option.

Fix ownership at that boundary: ordinary existing-input capture should retain
its input on failure/revocation, or copy into an explicitly owned publication
directory. Test a failed interaction and two grants sharing one input, proving
cleanup removes only command-owned outputs. Update the capture topic to state
the exact lifetime contract. Do not weaken cleanup for genuinely owned artifacts.

Deferred because this task is template mockup authoring, not artifact lifecycle
implementation. Capturing an already-created artifact URL avoids creating and
revoking another grant for the shared input during additional workflow checks.

Found 2026-09-21 while capturing the project-template chooser. Contributing-model:
6-Astra.
