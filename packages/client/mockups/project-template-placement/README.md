# New project and New session placement

Isolated mockup of the 2026-09-28 direction: always-visible template radio
palette, including a single choice; New session project menu with a typed-name
creation action and quick inline expansion. Entered prompt/name survive template
selection and expansion. The shared provider/model controls belong to the one
preparation session. No backend creation, source loading or provider calls occur.

Uses YA's actual theme and existing-directory AddProjectForm. New controls use
fixture-owned CSS Modules and fixed English copy. Bundled vector marks are
illustrative; source-provided artwork is tracked in
`gaps/sketches/project-template-artwork.md`. This fixture is not imported by the
production application. The earlier settings/permissions/app-name proposals
remain in the sibling `project-templates` fixture.

Build from the repository root:

```sh
pnpm --filter @yep-anywhere/client exec tsc -p mockups/project-template-placement/tsconfig.json
pnpm --filter @yep-anywhere/client exec vite build --config mockups/project-template-placement/vite.config.ts
```

Capture the project form, inline session creation and typed-name menu:

```sh
pnpm exec tsx packages/client/mockups/project-template-placement/capture.mts project
pnpm exec tsx packages/client/mockups/project-template-placement/capture.mts session
pnpm exec tsx packages/client/mockups/project-template-placement/capture.mts menu
```

The capture module asserts local sequential typing, choice visibility, retained
input and simulated submission. It emits the artifact facility's desktop/phone
previews plus a 1200×600 desktop capture. It makes a non-owning artifact request
so a failed/expired grant cannot delete the source bundle. An unauthenticated
server may refuse the interactive grant while screenshots still succeed.

Open `.artifacts/mockups/project-template-placement/index.html` in YA's file
viewer; use the review tabs for both placements. All state resets on reload.
Production implementation and load/permission verification remain in
`gaps/project-template-standup.md` and tactical 132.
