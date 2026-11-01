import { createContext, Fragment, type ReactNode, useContext } from "react";
import type { IssueMentionLinks } from "../lib/issueMentionLinks";
import styles from "./ui/LinkifiedText.module.css";

export const IssueMentionLinksContext = createContext<IssueMentionLinks | null>(
  null,
);

/** Display-only issue links; submitting and copying retain the original text. */
export function IssueMentionText({
  text,
  renderText,
}: {
  text: string;
  renderText?: (text: string) => ReactNode;
}) {
  const links = useContext(IssueMentionLinksContext);
  if (!links) return <>{renderText ? renderText(text) : text}</>;
  const parts: ReactNode[] = [];
  let end = 0;
  for (const match of text.matchAll(links.pattern)) {
    const plain = text.slice(end, match.index);
    parts.push(
      <Fragment key={match.index}>
        {renderText ? renderText(plain) : plain}
        <a
          className={styles.link}
          href={links.destinations.get(match[0])}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
        >
          {match[0]}
        </a>
      </Fragment>,
    );
    end = match.index + match[0].length;
  }
  const rest = text.slice(end);
  return (
    <>
      {parts}
      {renderText ? renderText(rest) : rest}
    </>
  );
}
