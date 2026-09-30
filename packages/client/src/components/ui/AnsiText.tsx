import { memo } from "react";
import { hasAnsiEscapes, renderAnsiToHtml } from "@yep-anywhere/shared";
import { profileRenderWork } from "../../lib/diagnostics/renderProfiler";
import { InnerHtml } from "./InnerHtml";
import { LinkifiedText } from "./LinkifiedText";
import {
  rewriteSessionAppLinksHtml,
  useSessionAppLinkRewriter,
} from "../SessionAppLinks";

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
  const rewriteHref = useSessionAppLinkRewriter();
  if (!hasAnsiEscapes(text)) {
    // Terminal output without colour still carries URLs worth clicking.
    const body = <LinkifiedText text={text} />;
    return as === "span" ? (
      <span className={className}>{body}</span>
    ) : (
      <code className={className}>{body}</code>
    );
  }

  const html = rewriteSessionAppLinksHtml(
    profileRenderWork(
      "ansi-render",
      () => ({
        chars: text.length,
        lines: text.length === 0 ? 0 : text.split("\n").length,
      }),
      () => renderAnsiToHtml(text),
    ),
    rewriteHref,
  );
  // renderAnsiToHtml escapes all payload text.
  return <InnerHtml as={as} className={className} trustedHtml={html} />;
});
