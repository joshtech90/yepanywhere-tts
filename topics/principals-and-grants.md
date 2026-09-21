# Principals and grants

> Architectural coordination sketch for authentication and authorization work:
> keep who or what is acting, how it proved that identity, what authority it
> received, and how it reached the server as separate concepts. This aligns the
> limited-user, hosted-issuer, session-guest, and peer-delegation proposals
> without approving a shared protocol or implementation.

Topic: principals-and-grants

Status: **proposal and shared vocabulary; nothing implemented.** This document
does not select an identity provider, require a hosted service, approve a grant
format, or make the related proposals roadmap commitments. Its purpose is to
make their relationship visible before one of them establishes a feature-local
identity or authorization model that the others cannot reuse.

## Why these proposals meet here

Several proposed features need to answer the same questions even though their
product shapes differ:

| Proposal | Authentication or introduction | Authority the target must enforce |
| --- | --- | --- |
| [[limited-users]] | Local username with password, cookie, or SRP proof | Selected projects and actions, with execution restrictions |
| Session guests in [[limited-users]] | Local guest credential | One session in read or turn mode |
| Hosted discovery and grant issuance in [[multi-machine-architecture]] | External account plus a device-key-bound issuer grant | Enrolled-server policy and the grant's target/action scope |
| [[cross-host-delegation]] | A distinct peer credential established during pairing | Directional worker/controller permissions and local ceilings |

The hosted issuer is potentially a more general way to introduce people and
devices, but it does not replace target-side authorization. Conversely, a
local limited-user account can exercise target-side authorization without any
hosted dependency. They are possible credential sources and policy profiles
around a shared conceptual seam, not necessarily one delivery sequence.

## Shared vocabulary

- **Principal** — the person, device, YA server, or narrowly scoped guest on
  whose behalf a request acts. A principal has a stable server-understood id;
  a display name or email address alone is not that id.
- **Credential** — proof accepted by an authenticator, such as the existing
  owner cookie, an SRP proof or resume credential, a local password, a peer
  credential, or a signed issuer statement bound to a device key.
- **Authentication context** — the principal plus the credential method and
  relevant provenance established for one request or connection. Current YA
  generally reduces this to an authenticated boolean; the proposals need more
  information without yet deciding its code shape.
- **Grant** — inspectable, bounded authority for a principal to perform actions
  against named resources. Candidate bounds include server, project, session,
  provider, action, time, and concurrency.
- **Local policy** — limits chosen and enforced by the target YA server. Trust
  in an external issuer may help establish a grant, but cannot widen the local
  policy ceiling.
- **Route or transport** — direct HTTP, LAN, Tailscale, or an encrypted relay
  circuit. Reachability carries no authority by itself.
- **Execution boundary** — the OS and provider restrictions that constrain
  work after an authorized request starts an agent. It is separate from API
  authorization.

The intended relationship is:

```text
credential authenticates principal
    -> target resolves applicable grant and local policy
    -> route authorizes the requested resource and action
    -> execution boundary constrains any resulting provider work
```

## Candidate shared properties

Any later proposal that turns this sketch into a contract should consider these
properties together. They are coordination criteria, not an approved wire or
storage schema:

- Authentication method and authorization policy remain separable, so adding
  hosted issuance does not require a second project-membership system and
  adding a local user does not define the hosted trust protocol.
- External identities are issuer-namespaced and sensitive grants are bound to
  proof of a device or peer private key. A mutable email address, display name,
  relay username, or URL is not sufficient identity.
- The target server computes effective authority from the grant and its local
  policy, and performs server-side checks on every affected route. Client-side
  filtering is presentation, not enforcement.
- Grants can be inspected and revoked where they are enforced. Expiry,
  credential renewal, issuer-key rotation, offline behavior, and revocation
  delay are explicit parts of any selected design.
- Authentication credentials, transport encryption keys, relay registration,
  and authorization grants remain distinct even when one flow establishes
  several of them.
- Authorization does not overstate execution isolation. A grant that permits
  agent input must still account for the session sandbox and the authority of
  the operating-system account running YA.

## Relationship to current YA

YA currently has one operator authority. A local password session, desktop
session, or Remote Access SRP session reaches the same operator API; the relay
username is a server-routing name as well as the single SRP identity, not a
person principal. Paired devices and browser profiles provide useful continuity
identity, but do not create application roles or project membership.

Existing public session shares and private app links are bearer grants with
their own bounded surfaces. They are relevant precedent for expiry,
revocation, and inventory, but do not yet form a general principal-and-grant
system.

## Coordination for future work

Before implementing named users, project or session membership, hosted grant
issuance, or peer authorization, review this sketch and state how the proposed
slice relates to its vocabulary. An incremental implementation may deliberately
support only one credential source or grant shape; it should identify which
seams are reusable and which questions it is deferring.

In particular, avoid assuming that:

- a local username must become the universal principal id;
- a hosted account automatically has authority on every enrolled server;
- successful relay or direct connection implies admission;
- a peer should reuse a browser password or resume credential; or
- a narrower UI establishes a server-side or execution boundary.

This coordination note does not prescribe whether local limited users, hosted
discovery, or a narrow guest/peer proof should be the first useful slice. That
ordering remains a product and implementation-plan decision.

## Open design questions

- Principal identifiers, issuer namespaces, persistence, and migration of the
  existing implicit owner.
- The authenticated-request context and the central route-authorization API.
- Grant resource/action vocabulary and whether policy profiles such as editor,
  viewer, or session guest are stored roles or compiled grants.
- Enrollment, key possession, rotation, recovery, outage behavior, and
  revocation latency for an optional hosted issuer.
- Credential and session lifetimes across cookie, SRP/resume, device, and peer
  flows.
- Audit and grant inventory shared by named principals and existing bearer
  links.
- Which authorized agent actions require a stronger execution boundary than
  the currently implemented sandbox provides.

## See also

- [[security]] — the current single-operator authority and trust boundaries.
- [[limited-users]] — a detailed local-user product and policy proposal.
- [[multi-machine-architecture]] — optional hosted discovery and grant
  issuance.
- [[cross-host-delegation]] — directional server-to-server trust and grants.
- [[mobile-server-pairing]] and [[security-client-audit]] — device continuity,
  resume credentials, audit, and revocation.
- [[relay-origin-and-share-gating]] and [[active-content-security]] — existing
  bearer-authority surfaces.
- [[session-sandboxing]] — the current execution boundary and its limits.
