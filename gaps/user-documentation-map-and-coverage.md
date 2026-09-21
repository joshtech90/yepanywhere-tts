# User guides in topics are missing from the README documentation path

There is already a user-documentation organization. Extend it after checking
coverage; do not create a parallel hierarchy or rewrite existing guides merely
to impose a new layout.

## Verified existing path

In this checkout, the root [README](../README.md) links to the public `/docs`
index. [`docs-navigation.ts`](../site/src/data/docs-navigation.ts) organizes
twelve guides under Start here, Connect, Use Yep Anywhere and Get help.
[`docs/index.astro`](../site/src/pages/docs/index.astro) renders that directory,
and the documentation layout reuses its navigation. Guide Markdown lives in
`site/src/content/docs/`; `site/src/content.config.ts` loads only that directory.
These are source-code findings, not verification of the currently deployed site.

The separate `topics/` collection holds product contracts and some user-facing
guides. `topics/README.md` is a technical topic list, not a user-task map. The
public navigation does not automatically expose user guides written there.

## Confirmed omissions and writing candidates

| User task | Existing material | Missing path or content |
| --- | --- | --- |
| Configure sources and author/share templates | [Template-authoring guide](../topics/project-template-authoring.md), already user-facing and vendored into agents | No entry in the public documentation navigation, no corresponding public guide, and no direct root-README link. Connect the existing canonical guide; do not write a competing copy. |
| Create and manage limited users | [Limited users](../topics/limited-users.md), mixing delivered v1 behavior with approved future extensions | No limited-user guide or navigation entry in `site/src/content/docs/`. Review the topic and write the missing user-facing instructions for delivered behavior; clearly separate pending template grants and personal-directory defaults. |

This is a seed inventory, not a completed documentation audit. Other missing
paths or material must be established by inspecting current guides and product
behavior rather than inferred from the size of the topics directory.

## Requested work

- Inventory existing user tasks and guides. Map each to its canonical
  user-facing document, owning technical topic/contract, and discoverable
  navigation path from README. Distinguish missing links, missing prose,
  obsolete prose, and intentionally pending functionality.
- Extend the existing user-documentation index with task-oriented labels.
  Make README → documentation map → relevant guide a clear, working path,
  including when README is read through YA's document viewer.
- Decide how a canonical user guide in `topics/` reaches the site and in-app
  viewer without independently maintained copies. A topic path is acceptable
  as the canonical source; its location alone does not establish user access.
  Link technical details separately where useful instead of presenting a raw
  developer-topic index as user documentation.
- Write genuinely missing user material, reusing reviewed facts from the
  owning topics. Keep user instructions distinct from implementation plans,
  proposals and maintainer procedures; preserve existing canonical ownership
  and vendor-sync relationships.
- Give [settings-caption links](settings-caption-documentation-links.md) the
  same stable documentation targets. That gap owns the caption UI facility;
  this gap owns content coverage and the README-discoverable documentation map.

Close when the coverage map identifies each reviewed task's real entry path,
the confirmed omissions are linked or written, and navigation is verified from
README through the index to the guide in browser and YA viewer. Check internal
links and site generation when changing the public documentation pipeline.

User requested capture of the organization/writing work, not implementation now.
Found 2026-09-21 while checking discovery of the template-authoring guide.
Contributing-model: 6-Astra.
