import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useI18n, type TranslationFn } from "../i18n";
import { CockpitAttentionCard } from "./CockpitAttentionCard";
import { CockpitCopyResponseButton } from "./CockpitCopyResponseButton";
import { CockpitReadAloudButton } from "./CockpitReadAloudButton";
import { CockpitComposer } from "./CockpitComposer";
import { CockpitModelControls } from "./CockpitModelControls";
import { CockpitQuickActions } from "./CockpitQuickActions";
import { CockpitStatusLed } from "./CockpitStatusLed";
import { CockpitStopButton } from "./CockpitStopButton";
import { CockpitTranscriptWindow } from "./CockpitTranscriptWindow";
import contentStyles from "./CockpitSessionContent.module.css";
import styles from "./CockpitSessionDetail.module.css";
import { CockpitToolCall } from "./CockpitToolCall";
import { createCockpitNavigation } from "./core/navigation";
import { countEntriesBeforeCockpitScrollAnchor } from "./core/scrollAnchor";
import {
  deriveCockpitSessionState,
  type CockpitAssistantEntry,
  type CockpitSessionState,
  type CockpitTranscriptEntry,
} from "./core/sessionDetail";
import type { CockpitShellState } from "./core/shellState";
import { cockpitContextUsage } from "./core/contextUsage";
import { cockpitLedToneForState } from "./core/statusLed";
import { selectCockpitTranscriptSnapshot } from "./core/transcriptScheduling";
import { useCockpitSessionDetail } from "./useCockpitSessionDetail";

export interface CockpitSessionDetailProps {
  basePath: string;
  /** Tells the list that this session works in another program right now. */
  onWorkingElsewhereChange?: (sessionId: string, working: boolean) => void;
  projectId: string;
  sessionId: string;
  shellKind: CockpitShellState["kind"];
}

function ArrowIcon({ direction }: { direction: "left" | "down" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {direction === "left" ? (
        <path d="m15 6-6 6 6 6" />
      ) : (
        <path d="m7 10 5 5 5-5" />
      )}
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 5h5v5M19 5l-8 8" />
      <path d="M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function sessionStateLabel(state: CockpitSessionState, t: TranslationFn) {
  switch (state) {
    case "active":
      return t("cockpitSessionStateActive");
    case "external":
      return t("cockpitSessionStateExternal");
    case "waiting":
      return t("cockpitSessionStateWaiting");
    case "reconnecting":
      return t("cockpitSessionStateReconnecting");
    case "complete":
      return t("cockpitSessionStateComplete");
    case "offline":
      return t("cockpitSessionStateOffline");
    case "error":
      return t("cockpitSessionStateError");
  }
}

function entryTime(timestamp: string | undefined, locale: string) {
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function findTranscriptEntryElement(
  container: HTMLElement,
  entryKey: string,
) {
  return [...container.querySelectorAll<HTMLElement>(
    "[data-cockpit-entry-key]",
  )].find((element) => element.dataset.cockpitEntryKey === entryKey);
}

function AssistantContent({ entry }: { entry: CockpitAssistantEntry }) {
  const { t } = useI18n();
  return (
    <>
      {entry.thinking.map((thinking) => (
        <details className={contentStyles.thinking} key={thinking.id}>
          <summary>
            <span>{t("cockpitSessionThinking")}</span>
            {thinking.status === "streaming" && (
              <span className={styles.streamingLabel}>
                {t("cockpitSessionThinkingStreaming")}
              </span>
            )}
          </summary>
          <p>{thinking.text}</p>
        </details>
      ))}
      {entry.text.map((segment) => (
        <div className={contentStyles.responseSegment} key={segment.id}>
          {segment.augmentHtml && !segment.isStreaming ? (
            <div
              className={contentStyles.renderedMarkdown}
              // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted server-rendered transcript Markdown
              dangerouslySetInnerHTML={{ __html: segment.augmentHtml }}
            />
          ) : (
            <div className={contentStyles.plainText}>{segment.text}</div>
          )}
          {segment.abortedMidStream && (
            <p className={contentStyles.interrupted}>
              {t("cockpitSessionInterrupted")}
            </p>
          )}
        </div>
      ))}
    </>
  );
}

const TranscriptEntry = memo(function TranscriptEntry({
  entry,
  locale,
  sessionWorking,
}: {
  entry: CockpitTranscriptEntry;
  locale: string;
  sessionWorking: boolean;
}) {
  const { t } = useI18n();
  const time = entryTime(entry.timestamp, locale);
  if (entry.kind === "boundary") {
    return (
      <div className={styles.boundary} data-cockpit-entry-key={entry.key}>
        <span aria-hidden="true" />
        <span>
          {entry.subtype === "compact_boundary"
            ? t("cockpitSessionBoundaryCompact")
            : t("cockpitSessionBoundaryStatus")}
        </span>
        <span aria-hidden="true" />
      </div>
    );
  }

  if (entry.kind === "user") {
    return (
      <article
        className={styles.userEntry}
        data-cockpit-entry-key={entry.key}
        data-entry-kind="user"
      >
        <header className={styles.entryHeader}>
          <strong>{t("cockpitSessionUser")}</strong>
          {time && <time dateTime={entry.timestamp}>{time}</time>}
        </header>
        {entry.text && <div className={styles.userText}>{entry.text}</div>}
        {entry.attachments && entry.attachments.length > 0 && (
          <ul
            aria-label={t("cockpitSessionAttachments")}
            className={styles.userAttachments}
          >
            {entry.attachments.map((file, index) => (
              <li key={`${file.name}\0${index}`}>
                <span>{file.name}</span>
                <small>{file.size}</small>
              </li>
            ))}
          </ul>
        )}
        {entry.text && (
          <footer className={styles.entryFooter}>
            <CockpitCopyResponseButton text={entry.text} target="prompt" />
          </footer>
        )}
      </article>
    );
  }

  if (entry.kind === "tool") {
    return (
      <CockpitToolCall
        entry={entry}
        sessionWorking={sessionWorking}
        time={time}
      />
    );
  }

  // Thinking without an answer yet is one quiet line, not an answer card.
  if (entry.text.length === 0 && entry.thinking.length > 0) {
    return (
      <article
        className={styles.thinkingEntry}
        data-cockpit-entry-key={entry.key}
        data-entry-kind="assistant"
      >
        <AssistantContent entry={entry} />
      </article>
    );
  }

  return (
    <article
      className={styles.assistantEntry}
      data-cockpit-entry-key={entry.key}
      data-entry-kind="assistant"
    >
      <header className={styles.entryHeader}>
        <span className={styles.assistantIdentity}>
          <span className={styles.assistantMark} aria-hidden="true">
            AI
          </span>
          <strong>{t("cockpitSessionAssistant")}</strong>
          {entry.isStreaming && (
            <span className={styles.streamingLabel}>
              {t("cockpitSessionStreaming")}
            </span>
          )}
        </span>
        {time && <time dateTime={entry.timestamp}>{time}</time>}
      </header>
      <div className={styles.assistantBody}>
        <AssistantContent entry={entry} />
      </div>
      {entry.spokenText && !entry.isStreaming && (
        <footer className={styles.entryFooter} data-align="start">
          <CockpitCopyResponseButton text={entry.spokenText} />
          <CockpitReadAloudButton id={entry.key} text={entry.spokenText} />
        </footer>
      )}
    </article>
  );
});

export function CockpitSessionDetail({
  basePath,
  onWorkingElsewhereChange,
  projectId,
  sessionId,
  shellKind,
}: CockpitSessionDetailProps) {
  const { locale, t } = useI18n();
  const runtime = useCurrentSourceRuntime();
  const navigation = useMemo(
    () => createCockpitNavigation(basePath),
    [basePath],
  );
  const detail = useCockpitSessionDetail(projectId, sessionId);
  const navigate = useNavigate();
  const location = useLocation();
  const actualSessionId = detail.composer.actualSessionId;
  // A new session starts under a temporary id; once the provider reports the
  // real one, the address follows it so a reload finds the session again.
  useEffect(() => {
    if (!actualSessionId || actualSessionId === sessionId) return;
    navigate(navigation.session(projectId, actualSessionId), {
      replace: true,
      state: location.state,
    });
  }, [actualSessionId, location.state, navigate, navigation, projectId, sessionId]);
  const deferredEntries = useDeferredValue(detail.entries);
  const transcriptEntries = selectCockpitTranscriptSnapshot(
    detail.entries,
    deferredEntries,
  );
  const interactionKey = JSON.stringify([
    runtime.sourceKey,
    projectId,
    sessionId,
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const prependRef = useRef<{
    anchorKey: string;
    anchorTop: number | null;
    projectId: string;
    sessionId: string;
    sourceKey: string;
    scrollHeight: number;
  } | null>(null);
  const [following, setFollowing] = useState(true);
  const [pinnedEntryKey, setPinnedEntryKey] = useState<string | null>(null);

  const hasEntries = transcriptEntries.length > 0;
  const state = deriveCockpitSessionState({
    transport:
      shellKind === "empty" && detail.loading && !hasEntries
        ? "loading"
        : shellKind,
    loadError: detail.error !== null,
    owner: detail.status.owner,
    processState: detail.processState,
    updatesConnected: detail.sessionUpdatesConnected,
    updatesResubscribing: detail.sessionUpdatesResubscribing,
    workingElsewhere: detail.workingElsewhere,
  });
  const sessionWorking =
    state === "active" ||
    state === "external" ||
    detail.processState !== "idle";

  const renderTranscriptEntry = useCallback(
    (entry: CockpitTranscriptEntry) => (
      <TranscriptEntry
        entry={entry}
        locale={locale}
        sessionWorking={sessionWorking}
      />
    ),
    [locale, sessionWorking],
  );

  useLayoutEffect(() => {
    prependRef.current = null;
    followingRef.current = true;
    setFollowing(true);
    setPinnedEntryKey(null);
  }, [interactionKey]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const prepend = prependRef.current;
    if (prepend) {
      if (
        prepend.sourceKey !== runtime.sourceKey ||
        prepend.projectId !== projectId ||
        prepend.sessionId !== sessionId
      ) {
        prependRef.current = null;
        setPinnedEntryKey(null);
      } else {
        const entriesBeforeAnchor = countEntriesBeforeCockpitScrollAnchor(
          prepend.anchorKey,
          transcriptEntries,
        );
        if (entriesBeforeAnchor === null) {
          prependRef.current = null;
          setPinnedEntryKey(null);
        } else if (entriesBeforeAnchor > 0) {
          const anchorElement = findTranscriptEntryElement(
            container,
            prepend.anchorKey,
          );
          const anchorTop = anchorElement?.getBoundingClientRect().top;
          container.scrollTop +=
            prepend.anchorTop !== null && anchorTop !== undefined
              ? anchorTop - prepend.anchorTop
              : container.scrollHeight - prepend.scrollHeight;
          prependRef.current = null;
          const releasePinnedEntry = () => setPinnedEntryKey(null);
          if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(releasePinnedEntry);
          } else {
            releasePinnedEntry();
          }
          return;
        } else {
          // A live append is not an older-page insertion. Keep the marker until
          // the explicit history request settles, without moving the reader or
          // charging the appended height to a later history prepend.
          const anchorElement = findTranscriptEntryElement(
            container,
            prepend.anchorKey,
          );
          prepend.anchorTop =
            anchorElement?.getBoundingClientRect().top ?? prepend.anchorTop;
          prepend.scrollHeight = container.scrollHeight;
          return;
        }
      }
    }
    if (followingRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [projectId, runtime.sourceKey, sessionId, transcriptEntries]);

  const showWorking = state === "active" || state === "external";
  const workingElsewhere = state === "external";
  useEffect(() => {
    if (!onWorkingElsewhereChange) return;
    onWorkingElsewhereChange(sessionId, workingElsewhere);
    return () => onWorkingElsewhereChange(sessionId, false);
  }, [onWorkingElsewhereChange, sessionId, workingElsewhere]);
  // The working line is not a transcript entry, so the follow effect above
  // does not see it appear; keep a reader at the end looking at it.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (showWorking && container && followingRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [showWorking]);

  // The phone shell measures its visible height after the first paint, so
  // the transcript can shrink after it was scrolled to the end; a reader who
  // follows the end keeps following it through such resizes.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (followingRef.current) container.scrollTop = container.scrollHeight;
    });
    observer.observe(container);
    const inner = container.firstElementChild;
    if (inner) observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const updateFollowing = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const next =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      72;
    if (next === followingRef.current) return;
    followingRef.current = next;
    setFollowing(next);
  }, []);

  const followLatest = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    followingRef.current = true;
    setFollowing(true);
    container.scrollTop = container.scrollHeight;
  }, []);

  const loadOlder = useCallback(async () => {
    const container = scrollRef.current;
    const anchorKey = transcriptEntries[0]?.key;
    if (container && anchorKey) {
      const anchorElement = findTranscriptEntryElement(container, anchorKey);
      prependRef.current = {
        anchorKey,
        anchorTop: anchorElement?.getBoundingClientRect().top ?? null,
        projectId,
        sessionId,
        sourceKey: runtime.sourceKey,
        scrollHeight: container.scrollHeight,
      };
      setPinnedEntryKey(anchorKey);
    }
    await detail.loadOlderMessages();
    const marker = prependRef.current;
    if (!marker) return;
    const clearSettledMarker = () => {
      if (prependRef.current !== marker) return;
      prependRef.current = null;
      setPinnedEntryKey(null);
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(clearSettledMarker);
    } else {
      clearSettledMarker();
    }
  }, [
    detail.loadOlderMessages,
    projectId,
    runtime.sourceKey,
    sessionId,
    transcriptEntries,
  ]);

  const title =
    detail.session?.customTitle?.trim() ||
    detail.session?.title?.trim() ||
    detail.session?.initialPrompt?.trim() ||
    t("cockpitSessionTitleFallback");
  const projectName =
    detail.session?.projectName?.trim() ||
    projectLabelFromId(projectId) ||
    t("cockpitUnknownProject");
  const classicHref = navigation.classicSession(projectId, sessionId);
  const contextUsage = cockpitContextUsage(detail.session?.contextUsage, locale);

  return (
    <article className={styles.root} aria-labelledby="cockpit-session-title">
      <header className={styles.sessionHeader}>
        <Link
          aria-label={t("cockpitSessionBack")}
          className={styles.backLink}
          to={navigation.cockpit}
        >
          <ArrowIcon direction="left" />
        </Link>
        <div className={styles.titleGroup}>
          <p>{projectName}</p>
          <h2 id="cockpit-session-title" title={title}>
            {title}
          </h2>
          {detail.restoredFromSnapshot && detail.loading && (
            <div className={styles.metadata}>
              <span>{t("cockpitSessionWarm")}</span>
            </div>
          )}
        </div>
        <div className={styles.sessionActions}>
          <CockpitStopButton
            interruptible={detail.attention.interruptible}
            key={`${interactionKey}:${
              detail.status.owner === "self"
                ? detail.status.processId
                : "cockpit-stop-idle"
            }`}
            stop={detail.attention.stop}
          />
          <CockpitQuickActions
            basePath={basePath}
            busy={
              state === "active" ||
              state === "external" ||
              state === "waiting" ||
              detail.processState !== "idle"
            }
            entries={detail.entries}
            port={detail.composer}
            projectId={projectId}
            sessionId={sessionId}
            sessionTitle={title}
          />
          <CockpitModelControls
            actualSessionId={detail.composer.actualSessionId}
            projectId={projectId}
            reconnectStream={detail.composer.reconnectStream}
            session={detail.session}
            setSessionModel={detail.setSessionModel}
            setStatus={detail.composer.setStatus}
            status={detail.status}
          />
          {contextUsage && (
            <span
              className={styles.contextUsage}
              title={
                contextUsage.percent === null
                  ? t("cockpitSessionContextTokensTitle", {
                      used: contextUsage.used,
                    })
                  : t("cockpitSessionContextUsageTitle", {
                      percent: contextUsage.percent,
                      used: contextUsage.used,
                      window: contextUsage.window,
                    })
              }
            >
              {contextUsage.percent === null
                ? contextUsage.short
                : t("cockpitSessionContextUsage", {
                    percent: contextUsage.percent,
                  })}
            </span>
          )}
          <span
            aria-live="polite"
            className={styles.sessionState}
            data-state={state}
          >
            <CockpitStatusLed
              label={sessionStateLabel(state, t)}
              tone={cockpitLedToneForState(state)}
            />
            {state !== "complete" && (
              <span aria-hidden="true">{sessionStateLabel(state, t)}</span>
            )}
          </span>
          <Link className={styles.classicLink} to={classicHref}>
            <ExternalIcon />
            <span>{t("cockpitSessionClassic")}</span>
          </Link>
        </div>
      </header>

      {detail.error && hasEntries && (
        <div className={styles.inlineError} role="status">
          <span>{t("cockpitSessionLoadErrorRetained")}</span>
          <button onClick={detail.reloadSession} type="button">
            {t("cockpitSessionRetry")}
          </button>
        </div>
      )}

      <div
        aria-busy={detail.loading || detail.loadingOlder}
        aria-label={t("cockpitSessionTranscriptAria")}
        className={styles.transcript}
        onScroll={updateFollowing}
        ref={scrollRef}
      >
        <CockpitTranscriptWindow
          afterRows={
            showWorking ? (
              <p className={styles.workingRow} role="status">
                <span aria-hidden="true" className={styles.workingDots}>
                  <i />
                  <i />
                  <i />
                </span>
                {state === "external"
                  ? t("cockpitSessionWorkingElsewhere")
                  : t("cockpitSessionWorking")}
              </p>
            ) : null
          }
          beforeRows={
            <>
              {detail.hasOlderMessages && (
                <button
                  className={styles.loadOlder}
                  disabled={detail.loadingOlder}
                  onClick={() => void loadOlder()}
                  type="button"
                >
                  <ArrowIcon direction="down" />
                  {detail.loadingOlder
                    ? t("cockpitSessionLoadingOlder")
                    : t("cockpitSessionLoadOlder")}
                </button>
              )}

              {detail.loading && !hasEntries && (
                <div className={styles.skeleton} role="status">
                  <span>{t("cockpitSessionLoading")}</span>
                  <i />
                  <i />
                  <i />
                </div>
              )}

              {detail.error && !hasEntries && !detail.loading && (
                <section className={styles.emptyState} role="alert">
                  <h3>{t("cockpitSessionLoadErrorTitle")}</h3>
                  <p>{t("cockpitSessionLoadErrorBody")}</p>
                  <button onClick={detail.reloadSession} type="button">
                    {t("cockpitSessionRetry")}
                  </button>
                </section>
              )}

              {!detail.loading && !detail.error && !hasEntries && (
                <section className={styles.emptyState} role="status">
                  <h3>{t("cockpitSessionEmptyTitle")}</h3>
                  <p>{t("cockpitSessionEmptyBody")}</p>
                </section>
              )}
            </>
          }
          entries={transcriptEntries}
          following={following}
          key={`${interactionKey}:transcript`}
          pinnedEntryKey={pinnedEntryKey}
          renderEntry={renderTranscriptEntry}
        />
      </div>

      {detail.attention.request && (
        <CockpitAttentionCard
          key={`${interactionKey}:${detail.attention.request.id}`}
          request={detail.attention.request}
          respond={detail.attention.respond}
        />
      )}

      <CockpitComposer
        projectId={projectId}
        sessionId={sessionId}
        sessionPort={detail.composer}
      />

      {!following && hasEntries && (
        <button
          className={styles.followButton}
          onClick={followLatest}
          type="button"
        >
          <ArrowIcon direction="down" />
          {t("cockpitSessionGoLatest")}
        </button>
      )}
    </article>
  );
}

/**
 * Project ids are base64url-encoded project paths. When the session summary
 * has no project name yet, the last path segment is a better header than a
 * generic fallback.
 */
export function projectLabelFromId(projectId: string): string | undefined {
  try {
    const base64 = projectId.replace(/-/g, "+").replace(/_/g, "/");
    const path = decodeURIComponent(
      Array.from(atob(base64), (char) =>
        `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
      ).join(""),
    );
    const name = path.split("/").filter(Boolean).pop()?.trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}
