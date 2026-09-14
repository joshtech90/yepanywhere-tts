/** Durable bounded resolution and deletion receipts, including early v4 profiles. */
export const ISSUE_RESOLUTION_SCHEMA = `
CREATE TABLE issue_resolution_jobs (
 project_id TEXT NOT NULL, ref_key TEXT NOT NULL, PRIMARY KEY(project_id,ref_key)
) WITHOUT ROWID;
CREATE TABLE issue_deleted_snapshots (
 project_id TEXT NOT NULL, ref_key TEXT NOT NULL, session_id TEXT NOT NULL, source_version TEXT NOT NULL,
 PRIMARY KEY(project_id,ref_key,session_id,source_version)
) WITHOUT ROWID;
`;
