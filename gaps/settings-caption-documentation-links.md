# Settings captions cannot link to relevant user documentation

Settings should let a caption include a discoverable link to the relevant
user guide. Today `SettingsCategory.description` and
`SettingsSectionProps.description` are plain strings; the shared caption
surface has no documentation-link contract. Authors must add a separate,
feature-specific link or leave the guide undiscoverable from its setting.

The concrete example is **Project templates**. Its user-facing guide lives at
[`topics/project-template-authoring.md`](../topics/project-template-authoring.md)
and is vendored as `agents/project-templates/README.md`. The technical
project-templates topic links to it, but neither YA's root README nor the
Project templates settings caption provides a direct user-facing path.

## Requested behavior

- Allow relevant user-documentation links in settings captions through the
  shared settings components. Start with Project templates → its authoring
  guide; reuse the same mechanism for other settings.
- Keep captions concise: aim for one wrapped line and use at most two,
  excluding the primary setting/category title. A short **Guide** link can
  accompany the existing description.
- Preserve translation and settings-search behavior, including readable
  search highlights and accessible link names. Documentation links must be
  independently keyboard/touch operable without conflicting with category
  navigation or creating nested interactive elements.
- Resolve the canonical user document through a supported documentation/viewer
  route. It must work for installed and hosted clients, not depend on the
  author's checkout or expose a machine-local `file:` URL. Prefer the existing
  YA document viewer where supported; choose the delivery route during
  implementation and retain one canonical document.

Close after a user can discover and open the template-authoring guide from
its settings caption, with desktop/phone captures and actual navigation
verification, including the supported remote path. Follow
[settings placement](../topics/settings-ui-placement.md) and
[settings search](../topics/settings-search.md).

The companion [user-documentation map and coverage gap](user-documentation-map-and-coverage.md)
owns the README-discoverable index, canonical guide destinations and missing
user material; this gap owns links from the settings caption surface.

User requested a gap rather than implementation of this shared UI facility.
Found 2026-09-21 while reviewing template-authoring guide discoverability.
Contributing-model: 6-Astra.
