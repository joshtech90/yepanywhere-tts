/**
 * The launch fields a limited user's account settles for them.
 *
 * Contract: topics/limited-users.md § Delivery v1. The form withholds the
 * pickers for these fields rather than offering a refused choice, so this
 * states the values instead — a caption with abbreviated versions of the same
 * indicators the rest of YA uses. Nothing here is focusable or clickable, so
 * it cannot read as a control that silently fails.
 */

import { Fragment, type ReactNode } from "react";
import { useI18n } from "../i18n";
import type { LaunchLock } from "../lib/limitedLaunchLock";
import { getSessionDefaultControlCopy } from "../lib/sessionDefaultControlCopy";
import { ProviderBadge } from "./ProviderBadge";
import styles from "./NewSessionFixedLaunch.module.css";

export interface NewSessionFixedLaunchProps {
  lock: LaunchLock;
  /** Catalog label for the locked model, when the catalog knows one. */
  modelLabel: string | null;
  /** Translated label for the locked effort. */
  effortLabel: string | null;
  /** Whether this server can sandbox at all; if not, no sandbox row. */
  sandboxAvailable: boolean;
  className?: string;
}

export function NewSessionFixedLaunch({
  lock,
  modelLabel,
  effortLabel,
  sandboxAvailable,
  className,
}: NewSessionFixedLaunchProps) {
  const { t } = useI18n();
  const copy = getSessionDefaultControlCopy(t);
  if (!lock.limited) return null;

  const rows: Array<{ key: string; label: string; value: ReactNode }> = [];
  if (lock.provider) {
    rows.push({
      key: "provider",
      label: copy.provider.title,
      value: (
        <ProviderBadge
          provider={lock.provider}
          model={lock.model ?? undefined}
          className={styles.badge}
        />
      ),
    });
  }
  // The badge abbreviates the model to a glyph, which is enough beside a
  // chosen model and not enough as the only statement of a fixed one.
  if (lock.model) {
    rows.push({
      key: "model",
      label: copy.model.title,
      value: modelLabel ?? lock.model,
    });
  }
  if (lock.effort) {
    rows.push({
      key: "effort",
      label: t("newSessionFixedEffortLabel"),
      value: effortLabel ?? lock.effort,
    });
  }
  if (sandboxAvailable) {
    rows.push({
      key: "sandbox",
      label: copy.sandbox.title,
      value: t("newSessionFixedSandboxValue"),
    });
  }
  if (rows.length === 0) return null;

  return (
    <section
      className={`${styles.fixedLaunch}${className ? ` ${className}` : ""}`}
      aria-label={t("newSessionFixedTitle")}
    >
      <h3>{t("newSessionFixedTitle")}</h3>
      <p className={styles.caption}>{t("newSessionFixedCaption")}</p>
      {/* Terms and values are direct grid children so the two columns align
          across rows without a per-row wrapper. */}
      <dl className={styles.rows}>
        {rows.map((row) => (
          <Fragment key={row.key}>
            <dt className={styles.rowLabel}>{row.label}</dt>
            <dd className={styles.rowValue}>{row.value}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}
