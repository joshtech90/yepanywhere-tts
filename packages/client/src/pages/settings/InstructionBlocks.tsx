import { MAX_INSTRUCTION_BLOCKS } from "@yep-anywhere/shared";
import { useI18n } from "../../i18n";
import { generateUUID } from "../../lib/uuid";
import styles from "./InstructionBlocks.module.css";

export interface InstructionBlockDraft {
  id: string;
  text: string;
}

export function instructionBlockDrafts(
  blocks: string[],
): InstructionBlockDraft[] {
  return blocks.map((text) => ({ id: generateUUID(), text }));
}

export function InstructionBlocks({
  value,
  onChange,
  disabled = false,
}: {
  value: InstructionBlockDraft[];
  onChange: (value: InstructionBlockDraft[]) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  function move(index: number, direction: number) {
    const next = [...value];
    const other = index + direction;
    [next[index], next[other]] = [next[other]!, next[index]!];
    onChange(next);
  }
  return (
    <div className={styles.blocks}>
      {value.length === 0 && (
        <p className={styles.hint}>{t("usersInstructionsEmpty")}</p>
      )}
      {value.map((block, index) => (
        <div className={styles.block} key={block.id}>
          <textarea
            aria-label={t("usersInstructionLabel", { number: index + 1 })}
            rows={3}
            value={block.text}
            disabled={disabled}
            placeholder={t("usersInstructionPlaceholder")}
            onChange={(event) =>
              onChange(
                value.map((item) =>
                  item.id === block.id
                    ? { ...item, text: event.target.value }
                    : item,
                ),
              )
            }
          />
          <div className={styles.tools}>
            <button
              type="button"
              className={styles.remove}
              disabled={disabled}
              aria-label={t("usersInstructionRemove", { number: index + 1 })}
              onClick={() =>
                onChange(value.filter((item) => item.id !== block.id))
              }
            >
              ×
            </button>
            {value.length > 1 && (
              <>
                <button
                  type="button"
                  disabled={disabled || index === 0}
                  aria-label={t("usersInstructionUp", { number: index + 1 })}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={disabled || index === value.length - 1}
                  aria-label={t("usersInstructionDown", { number: index + 1 })}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </>
            )}
          </div>
        </div>
      ))}
      <button
        type="button"
        className="settings-button"
        disabled={disabled || value.length >= MAX_INSTRUCTION_BLOCKS}
        onClick={() => onChange([...value, ...instructionBlockDrafts([""])])}
      >
        {t("usersInstructionAdd")}
      </button>
    </div>
  );
}
