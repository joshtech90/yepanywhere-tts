import type { ProviderName } from "@yep-anywhere/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useModelSettings } from "../hooks/useModelSettings";
import { useProviders } from "../hooks/useProviders";
import { useServerSettings } from "../hooks/useServerSettings";
import { useI18n } from "../i18n";
import { writeClipboardText } from "../lib/clipboard";
import styles from "./CockpitQuickActions.module.css";
import { CockpitModelField, CockpitThinkingField } from "./CockpitRunSettings";
import {
  type CockpitLaunchSelection,
  launchableProviders,
  launchChoices,
  selectionForProvider,
} from "./core/newSession";
import type { CockpitTranscriptEntry } from "./core/sessionDetail";
import { buildCockpitResumeCommand } from "./core/terminalCommand";
import type { CockpitComposerSessionPort } from "./useCockpitComposer";
import { useCockpitHandoff } from "./useCockpitHandoff";

export interface CockpitQuickActionsProps {
  basePath: string;
  entries: readonly CockpitTranscriptEntry[];
  port: CockpitComposerSessionPort;
  projectId: string;
  sessionId: string;
  sessionTitle: string;
  /** The session is busy here or in another program; no handoff then. */
  busy: boolean;
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />
    </svg>
  );
}

/**
 * Short commands for the open session: continue it in a terminal, or hand
 * it over to a fresh session with a chosen model and thinking level.
 */
export function CockpitQuickActions({
  basePath,
  busy,
  entries,
  port,
  projectId,
  sessionId,
  sessionTitle,
}: CockpitQuickActionsProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copied, setCopied] = useState<"idle" | "copied" | "error">("idle");
  const rootRef = useRef<HTMLDivElement>(null);
  const handoff = useCockpitHandoff({
    basePath,
    entries,
    port,
    projectId,
    sourceTitle: sessionTitle,
  });
  const command = buildCockpitResumeCommand({
    provider: port.session?.provider,
    projectId,
    sessionId: port.actualSessionId ?? sessionId,
  });

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [menuOpen]);

  useEffect(() => {
    if (copied === "idle") return;
    const timer = setTimeout(() => setCopied("idle"), 3500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyCommand = async () => {
    if (!command) return;
    setCopied((await writeClipboardText(command)) ? "copied" : "error");
    setMenuOpen(false);
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={t("cockpitQuickActions")}
        className={styles.trigger}
        data-state={copied}
        onClick={() => setMenuOpen((open) => !open)}
        title={
          copied === "copied"
            ? t("cockpitQuickTerminalCopied")
            : t("cockpitQuickActions")
        }
        type="button"
      >
        <BoltIcon />
        <span aria-live="polite" className={styles.srOnly}>
          {copied === "copied"
            ? t("cockpitQuickTerminalCopied")
            : copied === "error"
              ? t("cockpitQuickTerminalCopyFailed")
              : ""}
        </span>
      </button>
      {menuOpen && (
        <div
          aria-label={t("cockpitQuickActions")}
          className={styles.menu}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen(false);
            }
          }}
          role="menu"
        >
          <button
            className={styles.item}
            disabled={!command}
            onClick={() => void copyCommand()}
            role="menuitem"
            title={command ?? t("cockpitQuickTerminalUnavailable")}
            type="button"
          >
            <strong>{t("cockpitQuickTerminal")}</strong>
            <small>{t("cockpitQuickTerminalHint")}</small>
          </button>
          <button
            className={styles.item}
            disabled={busy}
            onClick={() => {
              setMenuOpen(false);
              handoff.reset();
              setDialogOpen(true);
            }}
            role="menuitem"
            type="button"
          >
            <strong>{t("cockpitQuickHandoff")}</strong>
            <small>
              {busy ? t("cockpitQuickHandoffBusy") : t("cockpitQuickHandoffHint")}
            </small>
          </button>
        </div>
      )}
      {dialogOpen && (
        <HandoffDialog
          handoff={handoff}
          onClose={() => setDialogOpen(false)}
          port={port}
        />
      )}
    </div>
  );
}

function HandoffDialog({
  handoff,
  onClose,
  port,
}: {
  handoff: ReturnType<typeof useCockpitHandoff>;
  onClose: () => void;
  port: CockpitComposerSessionPort;
}) {
  const { t } = useI18n();
  const { providers } = useProviders();
  const { settings } = useServerSettings();
  const { thinkingMode, effortLevel } = useModelSettings();
  const legacy = useMemo(
    () => ({ thinkingMode, effortLevel }),
    [effortLevel, thinkingMode],
  );
  const launchable = useMemo(() => launchableProviders(providers), [providers]);
  const [selection, setSelection] = useState<CockpitLaunchSelection | null>(
    null,
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const running = handoff.phase === "summarizing" || handoff.phase === "starting";

  // Start from the session's own provider and model; the rest from the saved
  // new-session defaults.
  useEffect(() => {
    if (selection || settings === null || launchable.length === 0) return;
    const provider =
      launchable.find((entry) => entry.name === port.session?.provider) ??
      launchable[0];
    if (!provider) return;
    const base = selectionForProvider(
      settings?.newSessionDefaults,
      provider,
      legacy,
      port.permissionMode,
    );
    // Sessions report full model ids (claude-haiku-4-5-…) while the picker
    // lists aliases (haiku); an alias contained in the id is the same model.
    const model = port.session?.model;
    const models = provider.models ?? [];
    const match = model
      ? (models.find((entry) => entry.id === model) ??
        models.find((entry) => entry.id.length > 3 && model.includes(entry.id)))
      : undefined;
    setSelection(match ? { ...base, model: match.id } : base);
  }, [launchable, legacy, port.permissionMode, port.session, selection, settings]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const providerInfo = launchable.find(
    (provider) => provider.name === selection?.provider,
  );
  const choices = selection ? launchChoices(selection, providerInfo, t) : null;
  const update = (patch: Partial<CockpitLaunchSelection>) =>
    setSelection((current) => (current ? { ...current, ...patch } : current));
  const chooseProvider = (name: ProviderName) => {
    const next = launchable.find((provider) => provider.name === name);
    if (!next) return;
    setSelection(
      selectionForProvider(
        settings?.newSessionDefaults,
        next,
        legacy,
        port.permissionMode,
      ),
    );
  };

  return (
    <div className={styles.backdrop}>
      <div
        aria-labelledby="cockpit-handoff-title"
        aria-modal="true"
        className={styles.dialog}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !running) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <h2 id="cockpit-handoff-title">{t("cockpitQuickHandoff")}</h2>
        <p className={styles.explain}>{t("cockpitHandoffExplain")}</p>

        {launchable.length > 1 && selection && (
          <div
            aria-label={t("newSessionProviderTitle")}
            className={styles.providers}
            role="radiogroup"
          >
            {launchable.map((provider) => (
              <button
                aria-checked={provider.name === selection.provider}
                className={styles.provider}
                disabled={running}
                key={provider.name}
                onClick={() => chooseProvider(provider.name)}
                role="radio"
                type="button"
              >
                {provider.displayName}
              </button>
            ))}
          </div>
        )}

        {choices && (
          <>
            <CockpitModelField
              disabled={running}
              models={choices.models}
              onChange={(model) => update({ model })}
              value={choices.effective.model}
            />
            {choices.supportsThinking && (
              <CockpitThinkingField
                disabled={running}
                effort={choices.effective.effortLevel}
                effortOptions={choices.effortOptions}
                mode={choices.effective.thinkingMode}
                modes={choices.thinkingModes}
                onEffortChange={(effortLevel) => update({ effortLevel })}
                onModeChange={(thinkingMode) => update({ thinkingMode })}
              />
            )}
          </>
        )}

        {running && (
          <p className={styles.progress} role="status">
            <span aria-hidden="true" className={styles.spinner} />
            {handoff.phase === "summarizing"
              ? t("cockpitHandoffSummarizing")
              : t("cockpitHandoffStarting")}
          </p>
        )}
        {handoff.error && (
          <p className={styles.error} role="alert">
            {handoff.error}
          </p>
        )}

        <div className={styles.actions}>
          <button
            className={styles.secondary}
            disabled={running}
            onClick={onClose}
            type="button"
          >
            {t("cockpitSessionMenuCancel")}
          </button>
          <button
            className={styles.primary}
            disabled={!choices || running}
            onClick={() => choices && void handoff.start(choices)}
            type="button"
          >
            {t("cockpitHandoffStart")}
          </button>
        </div>
      </div>
    </div>
  );
}
