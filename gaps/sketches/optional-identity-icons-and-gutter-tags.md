# Optional identity icons and left-gutter tags

Status: user-requested appearance sketch; implementation is not scheduled.

Offer optional icons for projects, providers, and the user through Appearance
settings. For the user, use a monogram when no user icon is available.

Prefer a provider marker beside its turn in the transcript margin. The
maintainer likes identity tags in the left gutter when space permits. These
should use available margin space without taking needed width from the message
or composer. On narrow layouts, including phones without a generous gutter,
the gutter markers may disappear.

## Intended behavior

- Appearance settings control whether these optional identity decorations show.
- Project icons identify projects; provider icons identify the provider of a
  turn; the user icon or monogram identifies user turns.
- Place transcript tags in the left gutter when there is enough room, aligned
  with the turn they identify.
- Hiding gutter decorations at narrow widths must leave the conversation
  understandable and its controls usable.

## Decisions left for implementation

Choose whether Appearance offers one switch or separate project, provider, and
user controls. Decide icon sources, monogram derivation, and the space threshold
for gutter placement. The request does not choose defaults or require an icon
upload feature.

Inspect `packages/client/src/pages/settings/AppearanceSettings.tsx`,
`packages/client/src/components/MessageList.tsx`, and existing provider badge
rendering before choosing the implementation. Verify both roomy desktop and
narrow phone layouts, including missing user icons and long identity labels.

Requested 2026-09-27 during the composer/new-session layout discussion.
Contributing-model: 6-Astra
