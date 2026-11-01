# User guides in topics are missing from the README documentation path

There is already a user-documentation organization. Extend it after checking
coverage; do not create a parallel hierarchy or rewrite existing guides merely
to impose a new layout.

## Verified existing path

In this checkout, the root [README](../README.md) links to the public `/docs`
index. [`docs-navigation.ts`](../site/src/data/docs-navigation.ts) organizes
thirteen guides under Start here, Connect, Use Yep Anywhere and Get help.
[`docs/index.astro`](../site/src/pages/docs/index.astro) renders that directory,
and the documentation layout reuses its navigation. Guide Markdown lives in
`site/src/content/docs/`; `site/src/content.config.ts` loads only that directory.
These are source-code findings, not verification of the currently deployed site.

The separate `topics/` collection holds product contracts. `topics/README.md`
is a technical topic list, not a user-task map, and the public navigation does
not expose anything written there. The template-authoring guide, first written
in `topics/`, now lives at
[`project-templates.md`](../site/src/content/docs/project-templates.md) with its
own navigation entry.

## Confirmed omissions and writing candidates

| User task | Existing material | Missing path or content |
| --- | --- | --- |
| Create and manage limited users | [Limited users](../topics/limited-users.md), mixing delivered v1 behavior with approved future extensions | No limited-user guide or navigation entry in `site/src/content/docs/`. Review the topic and write the missing user-facing instructions for delivered behavior; clearly separate pending template grants and personal-directory defaults. |

This is a seed inventory, not a completed documentation audit. Other missing
paths or material must be established by inspecting current guides and product
behavior rather than inferred from the size of the topics directory.

### Settings without adequate user documentation

The 2026-10-28 settings documentation-link sweep linked every setting it
judged not self-evident. These remain debt:

| Setting (pane) | Current link or material | Missing |
| --- | --- | --- |
| Allow All Hostnames / Allowed Hostnames (Local Access) | None committed | What the hostname check protects against (DNS rebinding), when a reverse proxy needs extra names, and the risk of allowing all. Unlinked. |
| Persist Remote Sessions to Disk (Remote Access) | Implementation notes only | The security trade-off of keeping relay resume credentials on disk. Unlinked. |
| Enable Device Bridge (Emulator) | User guide § Remote device control | Requirements (ADB, runtime download), ChromeOS host aliases, stream-quality trade-offs. |
| Users pane: instructions, browser defaults, grants | `topics/limited-users.md` (headed as a proposal) | Covered by the limited-users row above. |
| Learned speech vocabulary (Speech) | `topics/pluggable-speech-recognition.md` | User-level explanation of the scan window, Scan + Learn and Stop + Clear. Unlinked: its caption lives in `SpeechVocabularyControls.tsx`. |
| Smart Turn and spoken send/cancel/wait (Speech) | `topics/mic-button-speech-ui.md` | A user guide section. |
| Interactive HTML artifacts (Apps) | `topics/active-content-security.md` | Artifact address, listener port, link expiry, public vhost root, file vhosts, link rewriting and hosted sign-in. |
| Session Defaults: sandbox, recaps, prompt cache, compaction thresholds; Cache Billing; Agent Context; MCP App views; Agent Auth Router; rendez uploads; Project Queue readiness check; instruction restoration; Environment variables | Linked to owning contract topics | User guides. Agent Context's caption is also wrong for non-Claude providers (see [confusing settings](sketches/confusing-settings.md)). |
| Codex update policy (Providers) | None found | No caption and no document. |
| Remote Access relay setup | `site/src/content/docs/remote-access.md` exists | Not linked: its caption lives in `RemoteAccessSetup.tsx`. |

`site/src/content/docs/project-apps.md` also still names the current
**Hosted apps** table "Vhosts" (lines 11 and 21; line 78 deliberately
describes older servers).

## Requested work

- Inventory existing user tasks and guides. Map each to its canonical
  user-facing document, owning technical topic/contract, and discoverable
  navigation path from README. Distinguish missing links, missing prose,
  obsolete prose, and intentionally pending functionality.
- Extend the existing user-documentation index with task-oriented labels.
  Make README → documentation map → relevant guide a clear, working path,
  including when README is read through YA's document viewer.
- Write user guides in `site/src/content/docs/` with a navigation entry, and
  keep contracts in the owning topic. Link technical details separately where
  useful instead of presenting a raw developer-topic index as user
  documentation. Check that the in-app viewer can reach the same guide.
- Write genuinely missing user material, reusing reviewed facts from the
  owning topics. Keep user instructions distinct from implementation plans,
  proposals and maintainer procedures; preserve existing canonical ownership
  and vendor-sync relationships.
- Keep [settings documentation links](../topics/settings-ui-placement.md#documentation-links)
  pointed at the same stable targets: when a user guide is written for a
  setting that currently links its owning topic, move the link to the guide.
  This gap owns content coverage and the README-discoverable documentation map.

Close when the coverage map identifies each reviewed task's real entry path,
the confirmed omissions are linked or written, and navigation is verified from
README through the index to the guide in browser and YA viewer. Check internal
links and site generation when changing the public documentation pipeline.

User requested capture of the organization/writing work, not implementation now.
Found 2026-09-21 while checking discovery of the template-authoring guide.
Contributing-model: 6-Astra.
