# Routed sessions cannot use summary, title, recap and handoff launches

Routed sessions cannot use several ordinary YA auxiliary and successor paths
because those launches do not carry their Agent Auth Router account binding.
The current refusal prevents a fresh provider process from using the owner's
direct login, but leaves fork-with-summary, generated titles/recaps and
restart/handoff unavailable for routed work.

The remaining scope is recorded in
[the router topic](../topics/agent-auth-router.md#supported-slice-and-limits)
and its [inheritance follow-up](../topics/agent-auth-router.md#deferred-follow-ups).
`packages/server/src/supervisor/Supervisor.ts` owns
`routedSessionUnsupportedMessage`; `packages/server/src/routes/sessions.ts`
uses it to refuse restart/handoff, title generation and fork-with-summary.
The topic also records the recap-helper restriction. These are current
deliberate boundaries, not evidence that the guarded paths fall back today.

Ordinary menu clones, turn forks, `/btw` and question asides already inherit
the parent's account through separate child bindings. Native child work stays
inside its routed provider process. Those paths are not missing functionality
for this gap; `Supervisor.inheritRouterBinding` and
`AgentAuthRouter.inheritBinding` in
`packages/server/src/services/AgentAuthRouter.ts` provide the existing copy
behavior to examine when extending the remaining paths.

Follow-up should carry the selected account into each supported auxiliary
launch, with its own revocable child binding where appropriate. Successor
restart/handoff binding semantics need an explicit decision. Recheck current
grants, retain provider/model/effort/permission settings, and cover failed
allocation cleanup, cancellation, restart and revocation before removing a
refusal. Never rerun pool selection or fall back to direct provider credentials
as an incidental consequence of inheritance.

This is separate from
[Codex background calls using the direct login](routed-codex-calls-chatgpt-with-direct-login.md),
and from cross-account continuation or quota-exhaustion migration. No account
switching or exhaustion-recovery work is included.

Not fixed in place because this session is planning AAR diagnostics and an
agent-guided setup skill. The maintainer requested recording the remaining
inheritance paths for later work; no YA implementation or priority change is
part of that request.

Found 2026-10-15 while comparing Agent Auth Router features and narrowing the
remaining YA account-inheritance work.
