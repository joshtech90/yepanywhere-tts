import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { useI18n, type TranslationFn } from "../i18n";
import { CockpitAttentionCard } from "./CockpitAttentionCard";
import { CockpitReadAloudButton } from "./CockpitReadAloudButton";
import { CockpitComposer } from "./CockpitComposer";
import { CockpitModelControls } from "./CockpitModelControls";
import { CockpitStopButton } from "./CockpitStopButton";
import contentStyles from "./CockpitSessionContent.module.css";
import styles from "./CockpitSessionDetail.module.css";
import { CockpitToolCall } from "./CockpitToolCall";
import { createCockpitNavigation } from "./core/navigation";
import {
  deriveCockpitSessionState,
  type CockpitAssistantEntry,
  type CockpitSessionState,
  type CockpitTranscriptEntry,
} from "./core/sessionDetail";
import type { CockpitShellState } from "./core/shellState";
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

function TranscriptEntry({
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
      <div className={styles.boundary}>
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
      <article className={styles.userEntry} data-entry-kind="user">
        <header className={styles.entryHeader}>
          <strong>{t("cockpitSessionUser")}</strong>
          {time && <time dateTime={entry.timestamp}>{time}</time>}
        </header>
        <div className={styles.userText}>{entry.text}</div>
      </article>
    );
  }

  if (entry.kind === "tool") {
    return <CockpitToolCall entry={entry} time={time} />;
  }

  return (
    <article className={styles.assistantEntry} data-entry-kind="assistant">
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
            <CockpitReadAloudButton id={entry.key} text={entry.spokenText} />
          )}
        </span>
      </header>
      <div className={styles.assistantBody}>
        <AssistantContent entry={entry} />
      </div>
    </article>
  );
}

export function CockpitSessionDetail({
  basePath,
  projectId,
  sessionId,
  shellKind,
}: CockpitSessionDetailProps) {
  const { locale, t } = useI18n();
  const navigation = createCockpitNavigation(basePath);
  const detail = useCockpitSessionDetail(projectId, sessionId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const entryCountRef = useRef(detail.entries.length);
  entryCountRef.current = detail.entries.length;
  const prependRef = useRef<{
    entryCount: number;
    scrollHeight: number;
  } | null>(null);
  const [following, setFollowing] = useState(true);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const prepend = prependRef.current;
    if (prepend && detail.entries.length > prepend.entryCount) {
      container.scrollTop += container.scrollHeight - prepend.scrollHeight;
      prependRef.current = null;
      return;
    }
    if (followingRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [detail.entries]);

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
    if (container) {
      prependRef.current = {
        entryCount: detail.entries.length,
        scrollHeight: container.scrollHeight,
      };
    }
    await detail.loadOlderMessages();
    const marker = prependRef.current;
    if (marker && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        if (
          prependRef.current === marker &&
          entryCountRef.current === marker.entryCount
        ) {
          prependRef.current = null;
        }
      });
    }
  }, [detail.entries.length, detail.loadOlderMessages]);

  const hasEntries = detail.entries.length > 0;
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
            key={
              detail.status.owner === "self"
                ? detail.status.processId
                : "cockpit-stop-idle"
            }
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
        <div className={styles.transcriptInner}>
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

          {detail.entries.map((entry) => (
            <TranscriptEntry entry={entry} key={entry.key} locale={locale} />
          ))}
        </div>
      </div>

      {detail.attention.request && (
        <CockpitAttentionCard
          key={detail.attention.request.id}
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
