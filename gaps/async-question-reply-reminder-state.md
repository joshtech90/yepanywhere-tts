# Inline reply can leave the unanswered reminder visible

The user reported that the localhost session toolbar still showed
**1 question · 1 turn ago** after submitting an inline reply. The provider
transcript and the live session API both contain the answer, so provider
delivery succeeded. The reported server identified itself as
`0.8.1-63-g2f61a0f23`; the browser's loaded module revision and local question
records were not available for inspection.

The current browser integration in
`packages/client/e2e/async-questions.spec.ts` passes after completing onboarding
before its first reload. It covers successful choice/free-form replies,
failure/retry, decreasing reminder counts, reload persistence, and separate
main/inline drafts at desktop and phone widths. This does not reproduce the
reported live-tab failure. No runtime change was justified by that check.

The owning contract is
[`provider-output-contract`](../topics/provider-output-contract.md#answering-and-discovering-questions).
`AsyncQuestionsContext.submit` records the answer after a successful send;
`asyncQuestionRecords.ts` publishes it to mounted counts. The next useful
probe is the affected tab's exact source/session storage key, question id,
saved answer record, and loaded code revision across submission and durable
transcript reconciliation. Do not infer answer identity from a later user
message or clear unrelated reminders to hide the symptom.

The accompanying missing-text observation may concern a recently Enter-sent
message rather than an unsent draft. It is tracked with the existing
[unconfirmed-send gap](unconfirmed-send-loss-across-reload.md), separately from
reminder state.

Found 2026-09-07 during UI mockup export verification.
Contributing-model: 6-Astra
