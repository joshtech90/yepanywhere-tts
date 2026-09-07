# Skill activation does not load visualization metadata from its file

The workflow producer convention allows an invoked skill's
`metadata.visualization-schema` to activate its display. YA v1 implements
explicit announcement lines, but does not read a resolved `SKILL.md` to obtain
that field or deliver an activation to the client. Merely loading skill body
text is insufficient when the harness omits frontmatter. This is a current
missing integration, independent of any future restriction on sandbox reads.

## Evidence and available path provenance

- Claude Code, including the Claude/Opus provider, loads skills through native
  invocation/injection as well as model-selected reads. The installed Claude
  SDK's `SlashCommand` type exposes name, description, argument hint, and
  aliases; `mapClaudeSlashCommand` in `sdk/providers/claude.ts` does not obtain
  a skill-definition path or custom metadata from that inventory. A recorded
  native `Skill` call supplies the name; its injected text supplies
  `Base directory for this skill: <directory>` followed by the Markdown body,
  without the original frontmatter. YA already recognizes that body in
  `transcriptProjection/slashCommandBodies.ts` and preserves it in source
  messages. This is a path-provenance opportunity, not an implemented metadata
  reader. The inspected native Skill transcript used Claude Gateway/Sol;
  an Opus-specific invocation replay remains a validation case.
- Claude's [frontmatter documentation](https://code.claude.com/docs/en/skills#frontmatter-reference)
  explicitly leaves custom `metadata` to external tooling reading `SKILL.md`.
  Do not rely on the model repeating it or on injected body text retaining it.
- A recorded Grok 4.6 ACP session reads a skill using `read_file` with an
  absolute `rawInput.target_file`. The corresponding update also supplies
  `locations[].path` and `_meta["x.ai/tool"].input.path`.
  `grok-tool-normalization.ts` preserves this as canonical `Read.file_path`
  for live and replay. Separately, `grok-acp.ts` already carries advertised
  command `_meta.scope/path` as `providerDetails.grok`; provider tests cover
  that inventory path. No step reads visualization metadata from these files.
- Codex already discovers paths through `skills/list` and sends structured
  skill input on recognized invocations. Observed skill-file reads provide
  another entry point. Neither path currently activates workflow metadata.

## Required outcome

On an actual resolved skill invocation or observed skill read, the YA server
must obtain the definition path from provider provenance, read that file
directly, and extract `metadata.visualization-schema`. Resolve a relative
pointer against the real skill file's directory after following installation
symlinks. An absolute or home-relative pointer uses the session owner's host.
A skill name or an inventory listing alone must not activate every skill or
cause guessed-directory searches.

Send a turn-associated activation and either its resolved reference or the
validated declaration to the client as non-displayed metadata. Server-side
inline delivery avoids a second client file read; a reference can use the
existing authenticated raw-file API and conditional cache. This does not
require a synthetic Exec row or depend on Conversation View hiding one.
Preserve source identity, failed-resolution visibility, replay behavior, and
the default-off display setting. Missing or ambiguous provenance stays
unresolved. Review client/server compatibility before adding wire fields or
capabilities; explicit announcement support remains the fallback.

Closure needs native Claude/Opus, Grok 4.6, and Codex fixtures or isolated
smokes showing metadata-only activation, including symlinked skill aliases,
relative schema references, native injection without frontmatter, live/replay
parity, and unchanged disabled behavior. Do not invoke a publishing skill to
test this: use an inert skill and separate schema file.

Related: [workflow view](../topics/workflow-view.md) and
[skill invocation](../topics/skill-invocation.md). Explicit announcements in
recognized Exec result envelopes now use the shared decoder; that support
does not implement metadata-only activation.

Found 2026-09-07 during a real publish following workflow v1 implementation.
