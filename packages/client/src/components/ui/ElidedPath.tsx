import {
  shortenPath,
  splitDisplayPath,
  stripTrailingPathSeparators,
} from "../../lib/text";
import styles from "./ElidedPath.module.css";

/** Keep the path's final folder and name visible as its container narrows. */
export function ElidedPath({ path }: { path: string }) {
  const display = shortenPath(stripTrailingPathSeparators(path));
  const { dir, name } = splitDisplayPath(display);
  const parentStart = dir.slice(0, -1).lastIndexOf("/") + 1;
  const prefix = dir.slice(0, parentStart);
  const parent = dir.slice(parentStart);
  return (
    <span className={styles.path} title={path}>
      {prefix && <span className={styles.prefix}>{prefix}</span>}
      <span className={styles.tail}>
        {parent && <span className={styles.parent}>{parent}</span>}
        <span className={styles.name}>{name}</span>
      </span>
    </span>
  );
}
