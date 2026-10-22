/** Content belongs to a canonical tracker URL, never a project-local key. */
export const ISSUE_CONTENT_SCHEMA = `
CREATE TABLE issue_content (
 issue_id TEXT PRIMARY KEY REFERENCES external_issues(id) ON DELETE CASCADE,
 title TEXT, body TEXT, checked_at INTEGER NOT NULL,
 retry_after INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(state IN ('available','unavailable','failed')),
 etag TEXT, modified TEXT
);
CREATE TABLE issue_content_backoff (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), until_at INTEGER NOT NULL
);
`;
