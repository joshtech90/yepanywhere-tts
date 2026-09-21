import type { ProviderName } from "@yep-anywhere/shared";
import { useI18n } from "../i18n";
import { Modal } from "./ui/Modal";

export type LongContextEffortWarningChoice = "apply" | "fork" | "cancel";

interface LongContextEffortWarningModalProps {
  provider: ProviderName;
  contextTokens: number;
  currentEffortLabel: string;
  nextEffortLabel: string;
  /** Whether a fork is offered; false while the session cannot be forked. */
  canFork: boolean;
  busy: boolean;
  onChoose: (choice: LongContextEffortWarningChoice) => void;
}

/**
 * Confirmation shown before a mid-session effort change on a long-context
 * session: the change re-renders the system prompt, so the next request
 * re-reads most of the cached prompt. Contract:
 * topics/mid-session-effort-change.md.
 */
export function LongContextEffortWarningModal({
  provider,
  contextTokens,
  currentEffortLabel,
  nextEffortLabel,
  canFork,
  busy,
  onChoose,
}: LongContextEffortWarningModalProps) {
  const { t } = useI18n();
  const tokens = contextTokens.toLocaleString();
  return (
    <Modal
      title={t("longContextEffortWarningTitle")}
      onClose={() => onChoose("cancel")}
    >
      <div className="long-context-effort-warning">
        <p>
          {t("longContextEffortWarningBody", {
            tokens,
            from: currentEffortLabel,
            to: nextEffortLabel,
          })}
        </p>
        {canFork && (
          <p className="settings-hint">
            {provider === "codex" || provider === "codex-oss"
              ? t("longContextEffortWarningForkHintCodex")
              : t("longContextEffortWarningForkHint")}
          </p>
        )}
        <div className="model-switch-actions">
          <button
            type="button"
            className="settings-button settings-button-secondary model-switch-action-button"
            onClick={() => onChoose("cancel")}
            disabled={busy}
          >
            {t("modalCancel")}
          </button>
          {canFork && (
            <button
              type="button"
              className="settings-button settings-button-secondary model-switch-action-button"
              onClick={() => onChoose("fork")}
              disabled={busy}
            >
              {t("longContextEffortWarningFork", { to: nextEffortLabel })}
            </button>
          )}
          <button
            type="button"
            className="settings-button model-switch-action-button"
            onClick={() => onChoose("apply")}
            disabled={busy}
          >
            {t("longContextEffortWarningApply")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
