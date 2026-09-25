import {
  memo,
  useCallback,
  useDeferredValue,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { useI18n, type TranslationFn } from "../i18n";
import { CockpitAttentionCard } from "./CockpitAttentionCard";
import { CockpitCopyResponseButton } from "./CockpitCopyResponseButton";
import { CockpitReadAloudButton } from "./CockpitReadAloudButton";
import { CockpitComposer } from "./CockpitComposer";
import { CockpitModelControls } from "./CockpitModelControls";
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
import { selectCockpitTranscriptSnapshot } from "./core/transcriptScheduling";
import { useCockpitSessionDetail } from "./useCockpitSessionDetail";

export interface CockpitSessionDetailProps {
  basePath: string;
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
}: {
  entry: CockpitTranscriptEntry;
  locale: string;
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
          <span className={styles.entryActions}>
            {time && <time dateTime={entry.timestamp}>{time}</time>}
            <CockpitCopyResponseButton text={entry.text} target="prompt" />
          </span>
        </header>
        <div className={styles.userText}>{entry.text}</div>
      </article>
    );
  }

  if (entry.kind === "tool") {
    return <CockpitToolCall entry={entry} time={time} />;
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
        <span className={styles.entryActions}>
          {time && <time dateTime={entry.timestamp}>{time}</time>}
          {entry.spokenText && !entry.isStreaming && (
            <CockpitCopyResponseButton text={entry.spokenText} />
          )}
          {entry.spokenText && !entry.isStreaming && (
            <CockpitReadAloudButton id={entry.key} text={entry.spokenText} />
          )}
        </span>
      </header>
      <div className={styles.assistantBody}>
        <AssistantContent entry={entry} />
      </div>
    </article>
  );
});

export function CockpitSessionDetail({
  basePath,
  projectId,
  sessionId,
  shellKind,
}: CockpitSessionDetailProps) {
  const { locale, t } = useI18n();
  const runtime = useCurrentSourceRuntime();
  const navigation = createCockpitNavigation(basePath);
  const detail = useCockpitSessionDetail(projectId, sessionId);
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

  const renderTranscriptEntry = useCallback(
    (entry: CockpitTranscriptEntry) => (
      <TranscriptEntry entry={entry} locale={locale} />
    ),
    [locale],
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
  });
  const title =
    detail.session?.customTitle?.trim() ||
    detail.session?.title?.trim() ||
    detail.session?.initialPrompt?.trim() ||
    t("cockpitSessionTitleFallback");
  const projectName =
    detail.session?.projectName?.trim() || t("cockpitUnknownProject");
  const classicHref = navigation.classicSession(projectId, sessionId);

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
          <div className={styles.metadata}>
            {detail.session?.provider && (
              <span>{detail.session.provider}</span>
            )}
            {detail.session?.model && <span>{detail.session.model}</span>}
            {detail.restoredFromSnapshot && detail.loading && (
              <span>{t("cockpitSessionWarm")}</span>
            )}
          </div>
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
          <CockpitModelControls
            actualSessionId={detail.composer.actualSessionId}
            projectId={projectId}
            reconnectStream={detail.composer.reconnectStream}
            session={detail.session}
            setSessionModel={detail.setSessionModel}
            setStatus={detail.composer.setStatus}
            status={detail.status}
          />
          <span
            aria-live="polite"
            className={styles.sessionState}
            data-state={state}
          >
            <span aria-hidden="true" />
            {sessionStateLabel(state, t)}
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
