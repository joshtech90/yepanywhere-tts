import { memo } from "react";
import { hasAnsiEscapes, renderAnsiToHtml } from "@yep-anywhere/shared";
import { profileRenderWork } from "../../lib/diagnostics/renderProfiler";
import { LinkifiedText } from "./LinkifiedText";

interface Props {
  text: string;
  className?: string;
  as?: "code" | "span";
}

export const AnsiText = memo(function AnsiText({
  text,
  className,
  as = "code",
}: Props) {
  if (!hasAnsiEscapes(text)) {
    // Terminal output without colour still carries URLs worth clicking.
    const body = <LinkifiedText text={text} />;
    return as === "span" ? (
      <span className={className}>{body}</span>
    ) : (
      <code className={className}>{body}</code>
    );
  }

  const html = profileRenderWork(
    "ansi-render",
    () => ({
      chars: text.length,
      lines: text.length === 0 ? 0 : text.split("\n").length,
    }),
    () => renderAnsiToHtml(text),
  );
  return as === "span" ? (
    <span
      className={className}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: renderAnsiToHtml escapes all payload text
      dangerouslySetInnerHTML={{ __html: html }}
    />
  ) : (
    <code
      className={className}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: renderAnsiToHtml escapes all payload text
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
