# Limited-user instruction settings proposal

Review-only fixture for Settings → Users. The user requested mockups before
implementation on 2026-09-28. It reuses YA's theme and SettingsSection; the
surrounding settings navigation and account summary are illustrative. It makes
no settings, account or provider requests. Saves are local feedback, and reload
resets all state.

The shared editor starts with the requested image/video safety instruction as
one editable block. Blocks can be added, edited, removed and moved, and are
joined with blank lines in their displayed order. “Start from default” is
interpreted here as keeping the provider's default base instructions before
appending the shared blocks. Unchecking it replaces that base with the shared
blocks. Switching modes preserves all entered text.

Mobile density revision: blocks have no visible numbered title or header row.
A right-margin × removes each block; reorder arrows appear beneath it only
when there are multiple blocks. Text fields grow with their content, inherited
instructions collapse into one row, and Save/Preview share a row on phones.
The default shared editor fits in a 375×812 viewport without scrolling.

The per-user editor starts empty, shows inherited instructions separately, and
appends its blocks after the shared blocks. Only the administrator edits these
settings. A combined preview shows the custom text and whether a provider base
precedes it. The provider's actual built-in text is not simulated.

The fixed sandbox notice depicts the requested future restriction: all MCP
servers and connectors disabled for every sandboxed Claude session, regardless
of limited-user status. It is proposed behavior, not evidence of enforcement.
The safety instruction remains editable and is not itself a security boundary.

## Implementation follow-through

The production implementation is documented in
[Session sandboxing](../../../../topics/session-sandboxing.md#additional-launch-restrictions-and-instructions).
These were the design questions carried into implementation; this fixture stays
an isolated proposal, while production browser captures exercise Settings → Users.

- Map base replacement and appending to each supported provider's actual launch
  and instruction-loading mechanisms. In particular, distinguish built-in
  system instructions from global boot files such as CLAUDE.md and AGENTS.md;
  the mockup does not establish that those are interchangeable.
- Enforce Claude MCP/connector disabling at every confined launch, including
  resume and existing private homes. The current bootstrap copies settings,
  plugins and `.claude.json`; modifying only newly copied files is insufficient.
- Prevent per-user instructions from leaking through provider state shared by
  project. Define launch/resume ownership before writing principal-specific
  instructions into a sandbox home.
- The proposed timing is next launch, with running sessions retaining their
  current instructions. Decide how persisted sessions adopt later changes and
  how clients detect server support before implementing the settings contract.

## Build and capture

From the repository root:

```sh
pnpm --filter @yep-anywhere/client exec tsc -p mockups/limited-user-prompts/tsconfig.json
pnpm --filter @yep-anywhere/client exec vite build --config mockups/limited-user-prompts/vite.config.ts
pnpm exec tsx packages/client/mockups/limited-user-prompts/capture.mts shared
pnpm exec tsx packages/client/mockups/limited-user-prompts/capture.mts user
pnpm exec tsx packages/client/mockups/limited-user-prompts/capture.mts example
```

Open `.artifacts/mockups/limited-user-prompts/index.html` in YA's file viewer.
The two review tabs switch between shared and per-user settings. Captures use
the artifact facility, including 1000×600 and 375×812 viewports and full-page
1200px/375px images. The workflow checks sequential typing, reorder/remove,
mode switching, the empty per-user default, concatenation, local save feedback
and horizontal overflow. An unauthenticated server can refuse the interactive
grant while local captures still succeed.
