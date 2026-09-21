import { compactShikiLineBreaks } from "../lib/shikiHtml";
import styles from "./ShikiHtml.module.css";

/**
 * Render server-highlighted Shiki HTML.
 *
 * Owning the newline compaction and the block-per-line layout together keeps
 * them from drifting apart: the compaction deletes the only text separating
 * two lines, and this container's styles are what put them back on separate
 * rows. Callers add their own class for surface-specific treatment.
 */
export function ShikiHtml({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  return (
    <div
      className={`shiki-container ${styles.container}${className ? ` ${className}` : ""}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered HTML
      dangerouslySetInnerHTML={{ __html: compactShikiLineBreaks(html) ?? "" }}
    />
  );
}
