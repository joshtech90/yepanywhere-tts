import styles from "./NewSessionQueueMark.module.css";

export function NewSessionQueueMark() {
  return (
    <span className={styles.mark} aria-hidden="true">
      +
    </span>
  );
}
