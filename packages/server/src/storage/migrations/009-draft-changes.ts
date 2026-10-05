/** Bound draft catch-up reads by changed account rows instead of retained history. */
export const DRAFT_CHANGES_SCHEMA = `
CREATE INDEX drafts_changes ON drafts(owner,sequence,slot);
`;
