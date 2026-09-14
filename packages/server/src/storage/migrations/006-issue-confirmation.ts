/**
 * One durable verdict per reference, per project.
 *
 * A row is written when a reference is first seen and updated only by the
 * single lookup that follows, or by an explicit recheck. Its presence is what
 * stops a second automatic query: a key that was already answered, rejected or
 * unreachable is never asked about again on its own.
 */
export const ISSUE_CONFIRMATION_SCHEMA = `
CREATE TABLE issue_confirmations (
 project_id TEXT NOT NULL, provider TEXT NOT NULL, ref_key TEXT NOT NULL,
 state TEXT NOT NULL, title TEXT, detail TEXT, checked_at INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(project_id,provider,ref_key)
) WITHOUT ROWID;
CREATE INDEX idx_issue_confirmations_pending ON issue_confirmations(state);
`;
