import type { TemplateCreationGrant } from "@yep-anywhere/shared";
import { useProjectTemplateChoices } from "../../hooks/useProjectTemplateChoices";
import { useI18n } from "../../i18n";
import styles from "./UserTemplateGrant.module.css";

export function UserTemplateGrant({
  value,
  onChange,
}: {
  value: TemplateCreationGrant;
  onChange: (value: TemplateCreationGrant) => void;
}) {
  const { choices, error } = useProjectTemplateChoices(true);
  const { t } = useI18n();
  const selected = value.mode === "selected" ? value.templates : [];
  const templates = choices?.templates ?? [];
  const unavailable = selected.filter(
    (item) =>
      !templates.some(
        (choice) =>
          choice.sourceId === item.sourceId && choice.id === item.templateId,
      ),
  );
  return (
    <fieldset className={styles.grant}>
      <legend>{t("usersTemplatesHeading")}</legend>
      {(["none", "selected", "any"] as const).map((mode) => (
        <label className={styles.option} key={mode}>
          <input
            type="radio"
            name="template-creation-grant"
            checked={value.mode === mode}
            onChange={() =>
              onChange(
                mode === "selected" ? { mode, templates: selected } : { mode },
              )
            }
          />
          {t(`usersTemplates_${mode}`)}
        </label>
      ))}
      {value.mode === "selected" && (
        <div className={styles.choices}>
          {[
            ...templates.map((item) => ({
              sourceId: item.sourceId,
              templateId: item.id,
              title: item.title,
              icon: item.icon,
            })),
            ...unavailable.map((item) => ({
              ...item,
              title: `${item.sourceId}/${item.templateId} (${t("usersTemplateUnavailable")})`,
              icon: undefined,
            })),
          ].map((item) => {
            const checked = selected.some(
              (entry) =>
                entry.sourceId === item.sourceId &&
                entry.templateId === item.templateId,
            );
            return (
              <label
                className={styles.option}
                key={`${item.sourceId}/${item.templateId}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange({
                      mode: "selected",
                      templates: checked
                        ? selected.filter(
                            (entry) =>
                              entry.sourceId !== item.sourceId ||
                              entry.templateId !== item.templateId,
                          )
                        : [
                            ...selected,
                            {
                              sourceId: item.sourceId,
                              templateId: item.templateId,
                            },
                          ],
                    })
                  }
                />
                {item.icon && (
                  <img src={item.icon} alt="" width="24" height="24" />
                )}
                <span>
                  {item.title}
                  <small>{item.sourceId}</small>
                </span>
              </label>
            );
          })}
          {templates.length === 0 && <p>{t("templateNoReady")}</p>}
        </div>
      )}
      <p>{t("usersTemplatesHint")}</p>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
