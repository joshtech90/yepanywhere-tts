/** Personal drafts are durable user data, not rebuildable discovery indexes. */
export const DRAFT_SCHEMA = `
CREATE TABLE draft_meta (id INTEGER PRIMARY KEY CHECK(id=1), secret TEXT NOT NULL, sequence INTEGER NOT NULL DEFAULT 0);
CREATE TABLE draft_owners (owner TEXT PRIMARY KEY, sequence INTEGER NOT NULL DEFAULT 0, epoch TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE drafts (
 owner TEXT NOT NULL, slot TEXT NOT NULL, slot_json TEXT NOT NULL,
 revision TEXT NOT NULL, sequence INTEGER NOT NULL, payload TEXT NOT NULL,
 updated_at INTEGER NOT NULL, empty INTEGER NOT NULL,
 PRIMARY KEY(owner,slot)
) WITHOUT ROWID;
CREATE INDEX drafts_expiry ON drafts(empty,updated_at);
CREATE TABLE draft_receipts (
 owner TEXT NOT NULL, operation TEXT NOT NULL, request TEXT NOT NULL,
 response TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(owner,operation)
) WITHOUT ROWID;
CREATE INDEX draft_receipts_expiry ON draft_receipts(created_at);
CREATE TABLE draft_recovery (
 id INTEGER PRIMARY KEY, owner TEXT NOT NULL, slot TEXT NOT NULL,
 payload TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX draft_recovery_slot ON draft_recovery(owner,slot,id);
CREATE INDEX draft_recovery_expiry ON draft_recovery(created_at);
CREATE TABLE draft_files (
 owner TEXT NOT NULL, slot TEXT NOT NULL, attachment TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 PRIMARY KEY(owner,slot,attachment)
) WITHOUT ROWID;
CREATE INDEX draft_files_attachment ON draft_files(owner,attachment,expires_at);
CREATE INDEX draft_files_expiry ON draft_files(expires_at);
`;
