import { type HTMLAttributes, memo } from "react";
import { useInnerHtml } from "../../hooks/useInnerHtml";

type InnerHtmlProps = {
  as?: "code" | "div" | "span";
  /** Markup the caller has already escaped, sanitized, or generated itself. */
  trustedHtml: string;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "dangerouslySetInnerHTML">;

/**
 * An element whose content is trusted markup, rewritten only when the markup
 * changes. See {@link useInnerHtml} for why an inline `{ __html }` literal
 * rebuilds the DOM on every render and drops a reader's drag selection.
 */
export const InnerHtml = memo(function InnerHtml({
  as: Tag = "div",
  trustedHtml,
  ...props
}: InnerHtmlProps) {
  const innerHtml = useInnerHtml(trustedHtml);
  // biome-ignore lint/security/noDangerouslySetInnerHtml: callers pass trusted markup through the named prop
  return <Tag {...props} dangerouslySetInnerHTML={innerHtml} />;
});
