import { useMemo } from "react";
import { InnerHtml } from "../components/ui/InnerHtml";

/** The compact transcript has no file pane; keep documents in a separate tab. */
export function CockpitMarkdown({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const browserHtml = useMemo(() => {
    const document = new DOMParser().parseFromString(html, "text/html");
    for (const link of document.querySelectorAll(
      'a[data-ya-resource="project-file"]',
    )) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
    return document.body.innerHTML;
  }, [html]);
  return <InnerHtml className={className} trustedHtml={browserHtml} />;
}
