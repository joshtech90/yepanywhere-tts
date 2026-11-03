import { useMemo } from "react";
import {
  buildProjectFileViewerHref,
  parseLocalResourceHref,
} from "@yep-anywhere/shared";
import { InnerHtml } from "../components/ui/InnerHtml";

/** The compact transcript has no file pane; keep documents in a separate tab. */
export function CockpitMarkdown({
  html,
  className,
  basePath = "",
  projectId,
}: {
  html: string;
  className?: string;
  basePath?: string;
  projectId?: string;
}) {
  const browserHtml = useMemo(() => {
    const template = document.createElement("template");
    template.innerHTML = html;
    for (const link of template.content.querySelectorAll(
      'a[data-ya-resource="project-file"], a[data-ya-resource="local-file"]',
    )) {
      let href = link.getAttribute("href") ?? "";
      if (link.getAttribute("data-ya-resource") === "local-file" && projectId) {
        const resource = parseLocalResourceHref(href);
        if (resource?.kind === "local-file") {
          href = buildProjectFileViewerHref({
            projectId,
            filePath: resource.path,
            lineNumber: resource.lineNumber,
            columnNumber: resource.columnNumber,
          });
        }
      }
      if (href.startsWith("/projects/")) href = `${basePath}${href}`;
      link.setAttribute("href", href);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
    return template.innerHTML;
  }, [html, basePath, projectId]);
  return <InnerHtml className={className} trustedHtml={browserHtml} />;
}
