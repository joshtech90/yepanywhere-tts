# Multiplayer AI and collaborative live sessions

Research snapshot: **2026-09-30**. This is a product-level competitive review
of several people collaborating around an agent. It complements the individual
supervisor reviews in [the competitive index](README.md).

Evidence comes from official product documentation, release notes, repository
READMEs/security documents, and YC company profiles. These are documented
capabilities, not hands-on validation or implementation audits. An unavailable
source repository or an unsuccessful feature search is not proof of absence.
Availability, licenses, and permission boundaries should be rechecked before
relying on them for implementation or positioning.

Maintainer direction, 2026-09-30: retain the competitive analysis, but defer
digging into the open-source projects. Neither a source audit nor an integration
is selected by this document. Product priority remains with the
[roadmap](../roadmap/README.md).

## What counts as multiplayer

The relevant question is whether another human can join the same live agent
conversation and contribute to it without reconstructing context in a new
session. Distinguish these product models:

| Model | What is shared | Relevance to YA |
| --- | --- | --- |
| Frozen transcript / fork | A snapshot; further prompts belong to another conversation | Useful context transfer, without joint control of the original session |
| Live viewing | Updates from the ongoing conversation | Existing public Live Share baseline |
| Discussion / suggestions | Human chat or proposed prompts beside the original session | Useful participation before guest agent authority |
| Shared agent conversation | Several humans submit input into one continuing conversation | Direct match for participatory Live Share |
| Shared project, separate conversations | Files, task board, artifacts, or memory across individual agent chats | Team collaboration with different conversation ownership |
| Multiple agents | Agents delegate or exchange messages | Does not by itself establish human multiplayer |

Multi-device access, organization membership, and a shared execution environment
do not by themselves establish named participants, scoped input grants, or
independent human composers.

## Closest documented products

| Product | Documented collaboration | Availability and boundary |
| --- | --- | --- |
| **HumanLayer** | Temporarily share a running session; attributed messages; prompt together; shared response drafts with named cursors, presence, read-only viewing, and recovery | Multiplayer prompting released August 17; shared drafts September 12. The documented grant includes interrupting and resolving approvals, broader than YA's proposed guest input. Initial release required admin enablement. [Release notes][humanlayer-releases] |
| **Delta, from Zed** | Invite teammates into the same agent thread; comment on conversation/code; ask the original agent questions; continue work after another participant leaves | Public beta since September 16 on desktop and web. Conversation and worktree synchronization use DeltaDB. [Beta announcement][delta-beta], [product][delta-product] |
| **Coshell** | Several people prompt the same agent; named, visible queued prompts; separate session chat; presence, following, and shared browser previews | Web and terminal clients access a shared machine called a drive, including machines run by the team. Session visibility can be private, selected teammates, or the drive. [Docs][coshell-docs] |
| **mpai / multiplayer-ai** | Join an explicitly shared existing Claude Code or Codex session; read its context; add attributed prompts; viewer/participant roles, presence, revocation, and audit trail | MIT public alpha, terminal-first, macOS plus an existing Tailscale network. Writable Codex support requires its managed integration; standalone Codex sessions are view-only by default. [Repository][mpai-repo], [alpha contract][mpai-alpha] |
| **Slack Code** | Temporary code channels where humans exchange messages, direct supported agents, review work, and sign off on outputs | Gradual rollout. The underlying agent integration determines execution/account semantics; the channel alone does not prove every provider continues one task for different users. Slack's UI also exposes stopping an agent response. [User guide][slack-code], [announcement][slack-announcement] |

### Differences that matter for YA

**Permission granularity.** HumanLayer's live session grant documents prompting,
interruption, and approvals together. mpai documents a narrower route: invites
bind to the first Tailscale identity that uses them, default to selected-session
access, and provide no remote approval endpoint. Codex remote approvals are
declined; Claude remote turns deny operations needing an interactive permission
prompt. Its alpha contract also says disconnecting a prompting peer cancels that
turn, which differs from YA's desired separation between participant access and
owner execution. These are published boundaries, not a security audit.
[HumanLayer releases][humanlayer-releases], [mpai security][mpai-security],
[mpai alpha][mpai-alpha].

**Human chat and agent input.** Coshell's separate chat is useful UX precedent,
but it has an assistant: mentioning `@coshell` can cause it to send prompts to
the working agent, and it listens for a few minutes afterward. It should not be
cited as evidence of a strictly human-only scratch space. [Changelog][coshell-changelog].

**Draft ownership.** HumanLayer documents several people editing the same
response draft. YA's candidate independent composers and optional explicitly
shared draft previews are a different interaction model. Neither shared
drafts nor draft previews are necessary for basic chat or owner-reviewed
suggestions. [HumanLayer releases][humanlayer-releases].

**Authorship versus delivery.** Named prompts and visible sender chips show a
product addressing attribution. They do not establish a portable, structured
human-author field in every provider-native transcript or durable receipt for
each queued turn. Preserve that distinction when comparing against YA's
[named-participant proposal](../../gaps/sketches/named-participant-seats.md),
[provider turn-identity gap](../../gaps/provider-user-turn-durable-identity.md),
and [unconfirmed-send gap](../../gaps/unconfirmed-send-loss-across-reload.md).

## First-party and adjacent collaboration

| Product | Finding | Evidence limit |
| --- | --- | --- |
| **Claude Cowork** | Current help documentation lists session sharing as unavailable; individual artifacts can be shared | This is specific to Cowork, not all Anthropic collaboration products. [Help][cowork-help] |
| **Claude in Slack / Claude Tag** | Claude is a shared channel resource; everyone sees the work and can build on it | A separate surface from inviting someone into an existing Cowork session. [Product][claude-tag] |
| **Codex / ChatGPT Slack integration** | Related requests can continue the coding task when they use the same execution account; another account may start a separate task | No native invite-a-colleague flow into an existing live desktop/CLI session was found in the reviewed docs. Shared environments and Slack visibility do not establish that flow. [Official docs][codex-slack] |
| **Replit Agent 4** | Collaborators share a project and task board, but each has their own agent chat thread | Separate conversations are an explicit part of the current model. Older multiplayer AI Chat announcements should not establish current Agent behavior. [Agent 4 comparison][replit-agent4] |
| **Lovable** | Project collaborators can work in separate drafts with their own project chats and previews; edits reach the project when accepted | Shared project access is established; the reviewed page does not establish YA-style joint prompting of one existing live conversation. [Collaboration docs][lovable-collaboration] |

## YC activity

YC's current [Multiplayer AI request for startups][yc-rfs] explicitly calls for
teammates to enter the same live agent session, observe, redirect, and hand off
work. This supports the category's relevance, not any particular adoption or
security claim.

- **HumanLayer, Fall 2024:** the direct product match above.
  [YC profile][yc-humanlayer].
- **Mosaic, Summer 2026:** describes beginning as a live environment for people
  and agents, then focusing the product on centralized sessions and shared agent
  memory. Track its current direction without assuming its historical live
  environment remains the present product. [YC profile][yc-mosaic].
- **Glen, Summer 2026:** markets organizational context, unified agent transcripts,
  cross-harness handoff, and multiplayer agents in early access. This is adjacent
  evidence; the profile does not establish invitations and scoped prompting into
  one existing session. [YC profile][yc-glen].
- **QM, published by YC:** an MIT agent harness with shared rooms and scoped
  workspaces in Slack and web, deployable in an organization's cloud with its
  own models/keys. Its session-share links are separately documented as read-only
  snapshots. Shared rooms and transcript sharing have different authority.
  [Repository][qm-repo], [docs][qm-docs], [sharing contract][qm-sharing].

## Open-source status

| Product | What was verified |
| --- | --- |
| mpai | Public MIT source includes the described multiplayer product; alpha limitations apply. [Repository][mpai-repo] |
| QM | Public MIT harness with shared rooms and deployable services. [Repository][qm-repo] |
| HumanLayer | Current product FAQ says it is not yet open source. The older public repository says its code is deprecated; it is not evidence that current multiplayer is open. [FAQ][humanlayer-site], [old repository][humanlayer-old] |
| Delta | No published Delta/DeltaDB implementation verified. Zed's open-source editor is a separate product. [Zed source overview][zed-source] |
| Coshell | Built on open-source OpenCode; no published source for the multiplayer additions verified. Running a drive on one's own machine does not establish that the collaboration service is open source. [Changelog][coshell-changelog], [self-host guide][coshell-selfhost] |
| Mosaic / Slack Code | No open-source multiplayer implementation verified in this review |

No recommendation to clone, install, integrate, or audit these projects is made.

## Implications for YA

Live multi-human agent conversations are existing competitive functionality.
The useful comparisons are the collaborator's actual authority, conversation
ownership, attribution, and separation of human discussion from execution.

YA's proposed distinction is a progression of separately granted capabilities:
human discussion, owner-reviewed suggestions, then optional send/queue and
separately granted steer. A pending suggestion stays outside execution until the
owner approves a particular revision. Attribution retains both the suggestion
author and applying owner. Input authority does not include settings, approvals,
or stopping the provider. No reviewed source establishes this exact combination;
that is a bounded research finding, not a uniqueness claim.

These comparisons inform existing proposals rather than define new work:

- [Participatory Live Share](../../topics/relay-origin-and-share-gating.sketches.md#participatory-live-share)
  owns discussion/suggestion/input grants and admission.
- [Session notes and discussion](../../topics/session-notes-and-discussion.md)
  owns human-only content and personal/shared audience boundaries.
- [Principals and grants](../../topics/principals-and-grants.md) separates
  identity, credentials, membership, authority, and future accounts.
- [Delta research](deltadb.md) preserves the earlier provenance/version-control
  analysis; its September 15 snapshot predates the public beta.

Further investigation is justified by a concrete unanswered product or
permission question, rather than open-source availability alone.

[humanlayer-releases]: https://docs.humanlayer.com/release-notes
[humanlayer-site]: https://www.humanlayer.dev/
[humanlayer-old]: https://github.com/humanlayer/humanlayer
[delta-beta]: https://zed.dev/blog/delta-public-beta
[delta-product]: https://delta.dev/
[zed-source]: https://zed.dev/software-overview
[coshell-docs]: https://coshell.ai/docs
[coshell-changelog]: https://coshell.ai/changelog
[coshell-selfhost]: https://coshell.ai/self-host
[mpai-repo]: https://github.com/godfaddaai/multiplayer-ai
[mpai-alpha]: https://github.com/godfaddaai/multiplayer-ai/blob/main/docs/PUBLIC-ALPHA.md
[mpai-security]: https://github.com/godfaddaai/multiplayer-ai/blob/main/SECURITY.md
[slack-code]: https://slack.com/help/articles/54310833022355-Build-with-AI-as-a-team-using-Slack-Code
[slack-announcement]: https://docs.slack.dev/changelog/2026/08/20/slack-code/
[cowork-help]: https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork
[claude-tag]: https://claude.com/product/tag
[codex-slack]: https://learn.chatgpt.com/docs/third-party/slack#run-repository-work-in-codex-cloud
[replit-agent4]: https://replit.com/blog/whats-changed-agent3-to-agent4
[lovable-collaboration]: https://docs.lovable.dev/features/collaboration
[yc-rfs]: https://www.ycombinator.com/rfs#multiplayer-ai
[yc-humanlayer]: https://www.ycombinator.com/companies/humanlayer
[yc-mosaic]: https://www.ycombinator.com/companies/mosaic-inc
[yc-glen]: https://www.ycombinator.com/companies/glen
[qm-repo]: https://github.com/yc-software/qm
[qm-docs]: https://qm.ycombinator.com/
[qm-sharing]: https://github.com/yc-software/qm/blob/main/docs/session-sharing.md
