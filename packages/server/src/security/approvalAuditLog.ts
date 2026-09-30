import type { InputRequest, UserQuestionAnswers } from "@yep-anywhere/shared";
import { createAuditLog } from "./auditLog.js";

export const APPROVAL_AUDIT_LOG_MAX_BYTES = 25 * 1024 * 1024;

export interface ApprovalAuditEntry {
  timestamp: string;
  sessionId: string;
  processId: string;
  provider?: string;
  requestId: string;
  request: InputRequest | null;
  response: string;
  normalizedResponse: "approve" | "deny";
  answers?: UserQuestionAnswers;
  feedback?: string;
  accepted: boolean;
  failure?: string;
  permissionModeBefore: string;
  permissionModeAfter: string;
}

const approvalAuditLog = createAuditLog<ApprovalAuditEntry>({
  fileName: "approval-decisions.jsonl",
  maxBytes: APPROVAL_AUDIT_LOG_MAX_BYTES,
  label: "[approval-audit]",
});

export async function appendApprovalAuditLog(
  dataDir: string | undefined,
  entry: ApprovalAuditEntry,
): Promise<void> {
  return approvalAuditLog.append(dataDir, entry);
}
