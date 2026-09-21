# Project templates UI proposal

Isolated interactive proposal for Projects → New project, the immediately
available starter with a preparation session, and Settings → Users template
permissions. Uses the real `AddProjectForm`, `SettingsSection`, `I18nProvider`
and client theme stylesheet. New controls use fixture-owned CSS; labels are
fixed English, as in the existing projects mockup. Artifact CSP blocks native
form submission, so fixture creation uses a local button action and the existing
directory form's submit click is intercepted for preview feedback. Production integration must
use English i18n keys. No backend requests or provider sessions are made.

The review toolbar switches screens. Settings changes affect the limited-user
preview in memory; reloading resets them. App canvas and Web page have runnable
draft content in the agents library. The review toolbar's **Show template choices**
enables both in this scenario to demonstrate creation and permission lists.
Both project flows use selectable cards; a single choice omits the picker.
The starter image is illustrative;
the source template itself lives in the agents repository.

**App names** proposes Settings → Apps ownership of persistent wildcard-name
reservations. Its local reservation, conflict and confirmed-release controls
illustrate server behavior that remains unimplemented. Stopped apps and removed
projects retain their names; only the superuser can clear them.

From `packages/client`:

```sh
node_modules/.bin/tsc -p mockups/project-templates/tsconfig.json
node_modules/.bin/vite build --config mockups/project-templates/vite.config.ts
```

From repository root, capture through the normal artifact facility:

```sh
node_modules/.bin/tsx packages/client/scripts/capture-artifact.ts \
  .artifacts/mockups/project-templates/index.html --json
```

Add `--interact packages/client/mockups/project-templates/capture-users.mjs`
for the permission workflow, `capture-limited.mjs` for automatic selection,
`capture-workspace.mjs` for the combined user settings and personal sandbox,
or `capture-prepare.mjs` for real sequential typing and the starter visible
during preparation. Each module asserts the local interactions before capture.
These checks do not establish server authorization or production typing load.
Use a fresh `--out` directory for each capture, and inspect images individually.

`capture-choices.mjs` and `capture-limited-choices.mjs` verify template selection
and preservation of entered names when switching templates, then capture both
creation variants with the sample multi-template inventory enabled.

`capture-reservations.mjs` exercises duplicate rejection, reservation creation,
release cancellation and confirmed release, retaining the removed-project row.
Reviewed desktop/phone captures are under
`.artifacts/captures/project-templates-final-{reservations,workspace,limited-choices,prepare}/`.
Checks cover the isolated fixture; persistent storage, permission enforcement
and production session dispatch remain tracked implementation work.

The source bundle is `.artifacts/mockups/project-templates/index.html`; share
it via the artifact facility. See `topics/ui-design.md` for delivery, browser
requirements and source-vs-production boundaries, and
`topics/project-templates.md` for the agreed product behavior and open gap.
