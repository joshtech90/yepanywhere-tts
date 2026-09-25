import { useEffect } from "react";
import { useI18n } from "../i18n";
import type { CockpitOrganizationController } from "./useCockpitOrganization";
import styles from "./CockpitOrganizationBar.module.css";

export interface CockpitOrganizationBarProps {
  organization: CockpitOrganizationController;
  query: string;
  onQueryChange: (query: string) => void;
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5h10v15l-5-3-5 3v-15Z" />
    </svg>
  );
}

export function CockpitOrganizationBar({
  organization,
  query,
  onQueryChange,
}: CockpitOrganizationBarProps) {
  const { t } = useI18n();
  const selected = organization.views.find(
    (view) => view.id === organization.activeViewId,
  );

  useEffect(() => {
    if (selected) onQueryChange(selected.query);
  }, [onQueryChange, selected]);

  const saveLabel =
    query.trim().slice(0, 50) || t("cockpitOrganizationPinnedOnly");
  const canSave = query.trim().length > 0 || organization.pinnedOnly;

  return (
    <section
      aria-label={t("cockpitOrganizationAria")}
      className={styles.root}
    >
      <div className={styles.filters}>
        <button
          aria-pressed={!organization.pinnedOnly}
          onClick={() => organization.setPinnedOnly(false)}
          type="button"
        >
          {t("cockpitOrganizationAll")}
        </button>
        <button
          aria-pressed={organization.pinnedOnly}
          onClick={() => organization.setPinnedOnly(true)}
          type="button"
        >
          {t("cockpitOrganizationPinnedOnly")}
        </button>
        <button
          aria-label={t("cockpitOrganizationSave")}
          className={styles.save}
          disabled={!canSave}
          onClick={() =>
            organization.saveView({
              label: saveLabel,
              query,
              pinnedOnly: organization.pinnedOnly,
            })}
          title={t("cockpitOrganizationSave")}
          type="button"
        >
          <BookmarkIcon />
        </button>
      </div>

      {organization.views.length > 0 && (
        <div className={styles.savedViews}>
          <span>{t("cockpitOrganizationSaved")}</span>
          <div className={styles.savedViewList}>
            {organization.views.map((view) => (
              <span className={styles.savedView} key={view.id}>
                <button
                  aria-pressed={organization.activeViewId === view.id}
                  onClick={() => {
                    const activated = organization.activateView(view.id);
                    if (activated) {
                      onQueryChange(activated.query);
                    }
                  }}
                  type="button"
                >
                  {view.label}
                </button>
                <button
                  aria-label={t("cockpitOrganizationRemove", {
                    name: view.label,
                  })}
                  onClick={() => organization.removeView(view.id)}
                  type="button"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {organization.pinError && (
        <p className={styles.fallback} role="status">
          {t("cockpitPinUnavailable")}
        </p>
      )}
    </section>
  );
}
