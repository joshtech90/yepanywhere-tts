import {
  citedProjectPathTokenExtent,
  findProjectPathTokens,
  type ProjectPathLinkTarget,
} from "@yep-anywhere/shared";
import { Fragment, type ReactNode, useMemo } from "react";
import { SessionFilePathLink } from "./SessionFilePathLink";
import { useProjectPathLinkSettings } from "../contexts/ProjectPathLinkSettingsContext";
import { usePublicShareContext } from "../contexts/PublicShareContext";

export function ProjectPathLinkedText({
  links,
  renderText,
  text,
}: {
  links?: readonly ProjectPathLinkTarget[];
  renderText?: (text: string) => ReactNode;
  text: string;
}): ReactNode {
  const { projectPaths } = useProjectPathLinkSettings();
  const publicShare = usePublicShareContext();
  const segments = useMemo(() => {
    if (!links?.length || (!projectPaths && !publicShare)) return null;
    const targets = new Map(links.map((link) => [link.text, link.filePath]));
    const matches = findProjectPathTokens(text).filter((token) =>
      targets.has(token.text),
    );
    if (matches.length === 0) return null;

    const rendered: ReactNode[] = [];
    let cursor = 0;
    for (const [index, match] of matches.entries()) {
      if (match.start < cursor) continue;
      const filePath = targets.get(match.text)!;
      const { pathEnd, end, position } = citedProjectPathTokenExtent(
        text,
        match,
        filePath,
      );
      if (match.start > cursor) {
        const plainText = text.slice(cursor, match.start);
        rendered.push(
          <Fragment key={`text-${cursor}`}>
            {renderText ? renderText(plainText) : plainText}
          </Fragment>,
        );
      }
      rendered.push(
        <SessionFilePathLink
          key={`${match.start}-${index}`}
          displayPath={text.slice(match.start, pathEnd)}
          filePath={filePath}
          showCopyButton={false}
          showLineSuffix={false}
          showVersionControlLinks={false}
        />,
      );
      if (position) {
        rendered.push(
          <SessionFilePathLink
            key={`${match.start}-${index}-position`}
            displayPath={position.text}
            filePath={filePath}
            lineNumber={position.lineNumber}
            lineEnd={position.lineEnd}
            columnNumber={position.columnNumber}
            showCopyButton={false}
            showLineSuffix={false}
            showVersionControlLinks={false}
          />,
        );
      }
      cursor = end;
    }
    if (cursor < text.length) {
      const plainText = text.slice(cursor);
      rendered.push(
        <Fragment key={`text-${cursor}`}>
          {renderText ? renderText(plainText) : plainText}
        </Fragment>,
      );
    }
    return rendered;
  }, [links, renderText, text, projectPaths, publicShare]);

  if (segments) return segments;
  return renderText ? renderText(text) : text;
}
