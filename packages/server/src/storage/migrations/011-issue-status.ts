/** Durable tracker facts shared by every session mentioning an item. */
export const ISSUE_STATUS_SCHEMA = `
CREATE TABLE issue_tracker_status (
 issue_id TEXT PRIMARY KEY REFERENCES external_issues(id) ON DELETE CASCADE,
 state TEXT CHECK(state IN ('open','draft','closed','merged')),
 checked_at TEXT, node_id TEXT, merged_at TEXT, merge_commit_sha TEXT,
 asked_at INTEGER NOT NULL
);
`;
