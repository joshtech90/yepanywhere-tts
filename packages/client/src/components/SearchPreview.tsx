import type { ReactElement } from "react";
import styles from "./UserTurnNavigator.module.css";

export function renderHighlightedText(
  text: string,
  query: string,
  caseSensitive = false,
) {
  const normalizedQuery = query.replace(/\s+/g, " ").trim();
  if (!normalizedQuery) return text;
  const searchableText = caseSensitive ? text : text.toLowerCase();
  const searchableQuery = caseSensitive
    ? normalizedQuery
    : normalizedQuery.toLowerCase();
  const parts: Array<string | ReactElement> = [];
  let cursor = 0;
  let key = 0;
  while (cursor < text.length) {
    const index = searchableText.indexOf(searchableQuery, cursor);
    if (index === -1) break;
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(
      <mark key={key++} className={styles.previewMatch}>
        {text.slice(index, index + normalizedQuery.length)}
      </mark>,
    );
    cursor = index + normalizedQuery.length;
  }
  if (!parts.length) return text;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
