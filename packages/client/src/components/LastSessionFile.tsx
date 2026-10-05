import { useId, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuoteReply } from "../contexts/QuoteReplyContext";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useTextTooltipAttributes } from "../hooks/useTooltipAppearance";
import { useI18n } from "../i18n";
import { toBrowserAppHref } from "../lib/appHref";
import { useSessionLastFile } from "../lib/sessionLastFile";
import { useSessionViewerController } from "../lib/sessionViewerController";
import { buildProjectFileViewUrl } from "./FileDiffViewLinks";
import {
  getProjectViewerFilePath,
  presentProjectFileViewer,
} from "./FilePathLink";
import styles from "./LastSessionFile.module.css";

function parseFileRoute(route: string) {
  if (!route.startsWith("/projects/")) return null;
  const url = new URL(route, "http://session.local");
  const match = /^\/projects\/([^/]+)\/file$/.exec(url.pathname);
  const path = url.searchParams.get("path");
  if (!match || !path) return null;
  const positiveInteger = (key: string) => {
    const value = Number(url.searchParams.get(key));
    return Number.isInteger(value) && value > 0 ? value : undefined;
  };
  return {
    projectId: match[1] as string,
    filePath: getProjectViewerFilePath(match[1] as string, path),
    lineNumber: positiveInteger("line"),
    lineEnd: positiveInteger("lineEnd"),
    viewMode:
      url.searchParams.get("view") === "range"
        ? ("range" as const)
        : ("full" as const),
  };
}

/** Lightweight recall after Close, only where the transcript leaves a right margin. */
export function LastSessionFile({
  sessionId,
  target,
  inactive = false,
  quoteReply: suppliedQuoteReply,
}: {
  sessionId: string;
  target: HTMLElement | null;
  inactive?: boolean;
  quoteReply?: ReturnType<typeof useQuoteReply>;
}) {
  const route = useSessionLastFile(sessionId);
  const file = useMemo(() => parseFileRoute(route), [route]);
  const controller = useSessionViewerController();
  const basePath = useRemoteBasePath();
  const inheritedQuoteReply = useQuoteReply();
  const quoteReply = suppliedQuoteReply ?? inheritedQuoteReply;
  const viewerId = useId();
  const { t } = useI18n();
  const tooltip = useTextTooltipAttributes(file?.filePath);
  const [hasMargin, setHasMargin] = useState(false);

  useLayoutEffect(() => {
    const parent = target?.parentElement;
    if (!target || !parent || !route) {
      setHasMargin(false);
      return;
    }
    let transcript = parent.querySelector<HTMLElement>(".message-list");
    const measure = () => {
      // Keep the entire hit target outside the actual reading column, including
      // when Appearance changes its width or a right pane narrows the session.
      setHasMargin(
        transcript !== null &&
          target.getBoundingClientRect().right -
            transcript.getBoundingClientRect().right >=
            54,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    // After reload the transcript may hydrate after this sibling mounts. Stop
    // watching DOM additions as soon as its reading column becomes available.
    const waiting = new MutationObserver(() => {
      transcript = parent.querySelector<HTMLElement>(".message-list");
      if (!transcript) return;
      waiting.disconnect();
      observer.observe(transcript);
      measure();
    });
    if (transcript) observer.observe(transcript);
    else waiting.observe(parent, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      waiting.disconnect();
    };
  }, [target, route]);

  if (
    !target ||
    !file ||
    !hasMargin ||
    inactive ||
    controller?.sessionId === sessionId
  )
    return null;
  return createPortal(
    <button
      type="button"
      className={styles.reopen}
      aria-label={t("fileViewerRestore", { name: file.filePath })}
      {...tooltip}
      onClick={() =>
        presentProjectFileViewer({
          ...file,
          id: viewerId,
          sessionId,
          quoteReply,
          openInNewTabUrl: toBrowserAppHref(
            buildProjectFileViewUrl({ ...file, basePath }),
          ),
        })
      }
    >
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="m6 3 5 5-5 5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>,
    target,
  );
}
