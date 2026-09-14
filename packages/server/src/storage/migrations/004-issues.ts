/** Additive issue/evidence schema. Historical migrations are append-only. */
export const ISSUE_SCHEMA = `
CREATE TABLE external_issues (
 id TEXT PRIMARY KEY, ref_key TEXT NOT NULL, url TEXT NOT NULL,
 provider TEXT NOT NULL, kind TEXT NOT NULL, title TEXT, manual_title TEXT,
 created_at INTEGER NOT NULL
);
CREATE INDEX issue_ref_key ON external_issues(ref_key);
CREATE TABLE session_issue_links (
 id INTEGER PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES external_issues(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'discovered'
 CHECK(state IN ('discovered','confirmed','dismissed')), decision_at INTEGER NOT NULL DEFAULT 0,
 UNIQUE(issue_id, session_id)
);
CREATE INDEX issue_link_session ON session_issue_links(session_id);
CREATE TABLE session_issue_evidence (
 id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, project_id TEXT NOT NULL,
 occurrence TEXT NOT NULL, ref_key TEXT NOT NULL, provider TEXT NOT NULL,
 link_id INTEGER REFERENCES session_issue_links(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, observed_value TEXT NOT NULL, excerpt TEXT NOT NULL,
 message_id TEXT NOT NULL, observed_at INTEGER NOT NULL, source_time TEXT,
 suppressed INTEGER NOT NULL DEFAULT 0, extractor_version INTEGER NOT NULL DEFAULT 1,
 UNIQUE(session_id, occurrence)
);
CREATE INDEX issue_evidence_link ON session_issue_evidence(link_id, id);
CREATE INDEX issue_evidence_ref ON session_issue_evidence(ref_key, project_id);
CREATE INDEX issue_evidence_session ON session_issue_evidence(session_id, id);
CREATE TABLE issue_index_jobs (
 session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_version TEXT NOT NULL,
 cursor TEXT, state TEXT NOT NULL, error TEXT, updated_at INTEGER NOT NULL,
 source_json TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX issue_job_state ON issue_index_jobs(state, priority, updated_at);
`;
