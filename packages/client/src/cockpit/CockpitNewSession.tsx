import type {
  ImagePreparationProfile,
  ProviderName,
  SessionCreationReceipt,
  StagedAttachmentRef,
} from "@yep-anywhere/shared";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { SessionOptions } from "../api/client";
import { useCurrentSourceRuntime } from "../contexts/SourceRuntimeContext";
import { isRequestDeadlineError } from "../api/requestDeadline";
import {
  getAttachmentUploadProfile,
  useAttachmentUploadQuality,
} from "../hooks/useAttachmentUploadQuality";
import { useModelSettings } from "../hooks/useModelSettings";
import { useProjects } from "../hooks/useProjects";
import { useProviders } from "../hooks/useProviders";
import { useServerSettings } from "../hooks/useServerSettings";
import { useI18n } from "../i18n";
import {
  revokeAttachmentPreviewUrls,
  toPersistedStagedAttachmentRef,
  type ComposerStagedAttachment,
} from "../lib/sessionComposerAttachments";
import { hasCoarsePointer } from "../lib/deviceDetection";
import { uploadComposerAttachmentFile } from "../lib/sessionComposerSubmission";
import { createSessionNavigationState } from "../lib/sessionNavigationState";
import type { SourceTransport } from "../lib/transport";
import { generateUUID } from "../lib/uuid";
import {
  CockpitAttachmentDropCue,
  useCockpitAttachmentDropTarget,
} from "./CockpitAttachmentDropTarget";
import { CockpitFolderPicker } from "./CockpitFolderPicker";
import styles from "./CockpitNewSession.module.css";
import { useCockpitAppShare } from "./useCockpitAppShare";
import {
  CockpitProjectFavorites,
  useCockpitProjectFavoriteMenu,
  useCockpitProjectFavorites,
} from "./CockpitProjectFavorites";
import {
  CockpitModelField,
  CockpitPermissionField,
  CockpitThinkingField,
} from "./CockpitRunSettings";
import { createCockpitNavigation } from "./core/navigation";
import {
  initialLaunchSelection,
  launchableProviders,
  launchChoices,
  launchOptions,
  normalizeProjectPath,
  rememberLaunch,
  selectionForProvider,
  type CockpitLaunchSelection,
} from "./core/newSession";
import {
  addFavorite,
  defaultFavoriteLabel,
  findFavorite,
  projectForFolder,
  removeFavorite,
} from "./core/projectFavorites";
import { COCKPIT_UPLOAD_STALL_MS } from "./useCockpitComposer";
import { insertDictation, useCockpitDictation } from "./useCockpitDictation";
import { CockpitDictationButton } from "./CockpitDictationButton";

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 7.5h6l1.7 2H20.5v8.7a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8V7.5Z" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3Z" />
    </svg>
  );
}

function PaperClipIcon() {
  return (
    <svg className={styles.attachIcon} viewBox="0 0 24 24" aria-hidden="true">
      <path d="m19 11.5-7.1 7.1a4.6 4.6 0 0 1-6.5-6.5l7.8-7.8a3.1 3.1 0 0 1 4.4 4.4l-7.8 7.8a1.5 1.5 0 0 1-2.1-2.1l7.1-7.1" />
    </svg>
  );
}

const OTHER_FOLDER = "\0other";

/** A file picked for the first message; it uploads as a staged file at the start. */
interface CockpitNewSessionFile {
  id: string;
  file: File;
}

/**
 * One staged upload for the first message that gives up once no bytes have moved for
 * a while: the shared transport can wait forever on a sleeping host, and the
 * form would then stay at "Starting" with every button disabled.
 */
function uploadWithStallGuard(
  file: File,
  transport: SourceTransport,
  options: {
    batchId: string;
    imageProfile: ImagePreparationProfile;
    stalledMessage: string;
    onProgress: (percent: number) => void;
  },
): Promise<ComposerStagedAttachment> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    // Armed only once bytes go to the host, so shrinking a photo first never
    // counts as a stall.
    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        controller.abort();
        reject(new Error(options.stalledMessage));
      }, COCKPIT_UPLOAD_STALL_MS);
    };
    uploadComposerAttachmentFile({
      file,
      sourceTransport: {
        upload: (...args) => {
          armStallTimer();
          return transport.upload(...args);
        },
        uploadStagedAttachment: (...args) => {
          armStallTimer();
          return transport.uploadStagedAttachment(...args);
        },
      },
      // Staged uploads ignore project and session: the files bind to the
      // session the creation request makes (upstream 085beaf0a retired the
      // empty "create first, upload after" route).
      projectId: "",
      sessionId: "",
      stagedBatchId: options.batchId,
      imageProfile: options.imageProfile,
      signal: controller.signal,
      onProgress: (bytesUploaded, uploadFile) => {
        armStallTimer();
        options.onProgress(
          Math.round((bytesUploaded / Math.max(uploadFile.size, 1)) * 100),
        );
      },
    })
      .then((uploaded) => {
        const attachment = uploaded as ComposerStagedAttachment;
        // A stalled attempt that still finishes only frees its preview.
        if (controller.signal.aborted) {
          revokeAttachmentPreviewUrls([attachment]);
          return;
        }
        resolve(attachment);
      }, reject)
      .finally(() => clearTimeout(stallTimer));
  });
}

/** Home prefixes shortened so the folder list stays readable on a phone. */
function shortPath(path: string): string {
  return path.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, "~");
}

export interface CockpitNewSessionProps {
  basePath: string;
  /** Project preselected from the link, e.g. "new session in this project". */
  projectId?: string | null;
}

export function CockpitNewSession({
  basePath,
  projectId,
}: CockpitNewSessionProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const runtime = useCurrentSourceRuntime();
  const navigation = useMemo(
    () => createCockpitNavigation(basePath),
    [basePath],
  );
  const { projects } = useProjects();
  const { providers, loading: providersLoading } = useProviders();
  const { settings, updateSetting } = useServerSettings();
  const { thinkingMode, effortLevel } = useModelSettings();
  const legacy = useMemo(
    () => ({ thinkingMode, effortLevel }),
    [effortLevel, thinkingMode],
  );
  const defaults = settings?.newSessionDefaults;
  const launchable = useMemo(() => launchableProviders(providers), [providers]);
  const sortedProjects = useMemo(
    () =>
      [...projects].sort((left, right) =>
        (right.lastActivity ?? "").localeCompare(left.lastActivity ?? ""),
      ),
    [projects],
  );

  const [selection, setSelection] = useState<CockpitLaunchSelection | null>(
    null,
  );
  const [projectChoice, setProjectChoice] = useState<string | null>(
    projectId ?? null,
  );
  const [folder, setFolder] = useState("");
  // A folder picked by favourite or picker before the project list arrived;
  // it moves to its project once the list knows it. Typing clears it.
  const [pickedFolder, setPickedFolder] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const favorites = useCockpitProjectFavorites();
  const favoriteMenu = useCockpitProjectFavoriteMenu(favorites);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<CockpitNewSessionFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>(
    {},
  );
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachmentQuality] = useAttachmentUploadQuality();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  // The mic button takes focus when pressed, so the caret is remembered from
  // the textarea's own selection events rather than read at insert time.
  const messageSelectionRef = useRef<{ start: number; end: number } | null>(
    null,
  );
  const dictatedCaretRef = useRef<number | null>(null);
  const dictation = useCockpitDictation((text) => {
    const selection = messageSelectionRef.current;
    // A share can land in the same render as the transcript, so the insert has
    // to build on the queued message rather than on what the DOM shows.
    setMessage((current) => {
      const next = insertDictation(current, text, selection);
      dictatedCaretRef.current = next.caret;
      messageSelectionRef.current = { start: next.caret, end: next.caret };
      return next.value;
    });
  });
  // Runs after every render: the ref is only set by the update that inserts.
  useLayoutEffect(() => {
    const caret = dictatedCaretRef.current;
    if (caret === null) return;
    dictatedCaretRef.current = null;
    const input = messageRef.current;
    if (!input) return;
    // Phones would pop the keyboard over the form; leave focus where it was.
    if (!hasCoarsePointer()) input.focus({ preventScroll: true });
    input.setSelectionRange(caret, caret);
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Files stay local until the start: an upload needs the session's folder.
  const attachFiles = (picked: File[]) => {
    if (starting || picked.length === 0) return;
    setFiles((current) => [
      ...current,
      ...picked.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
      })),
    ]);
    setError(null);
  };
  const attachmentDrop = useCockpitAttachmentDropTarget(attachFiles);
  useCockpitAppShare(
    (text) =>
      setMessage((current) =>
        current.trim() ? `${current}\n\n${text}` : text,
      ),
    attachFiles,
    (count) => setError(t("cockpitAppShareMissingFiles", { count })),
    !starting,
  );
  // A start that finishes after this view was left must not navigate back;
  // the session still runs and shows up in the list.
  const mountedRef = useRef(true);
  /** The last creation whose outcome the host never confirmed. */
  const unconfirmedCreation = useRef<{
    sourceKey: string;
    intent: string;
    requestId: string;
    clientTimestamp: number;
    stagedAttachments: StagedAttachmentRef[];
  } | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const folderRef = useRef<HTMLInputElement>(null);
  const projectFieldId = useId();
  const folderFieldId = useId();
  const messageFieldId = useId();

  // Seed once providers and saved defaults are known; later provider refreshes
  // must not overwrite what Joscha already picked.
  useEffect(() => {
    if (selection || settings === null || launchable.length === 0) return;
    setSelection(initialLaunchSelection(defaults, launchable, legacy));
  }, [defaults, launchable, legacy, selection, settings]);

  useEffect(() => {
    if (projectChoice !== null) return;
    const recent = sortedProjects[0];
    if (recent) setProjectChoice(recent.id);
  }, [projectChoice, sortedProjects]);

  // Desktop starts typing at once; on a phone the keyboard would cover the
  // settings, so focus waits for a tap there.
  useEffect(() => {
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    messageRef.current?.focus({ preventScroll: true });
  }, []);

  const providerInfo = launchable.find(
    (provider) => provider.name === selection?.provider,
  );
  const choices = selection ? launchChoices(selection, providerInfo, t) : null;
  const customFolder = projectChoice === OTHER_FOLDER;
  const folderPath = normalizeProjectPath(folder);
  const chosenProject = customFolder
    ? undefined
    : sortedProjects.find((project) => project.id === projectChoice);
  const currentPath = customFolder
    ? folderPath || null
    : (chosenProject?.path ?? null);
  const currentFavorite = currentPath
    ? findFavorite(favorites.favorites, currentPath)
    : undefined;

  /** A known project is picked in the list; any other folder is typed in. */
  const chooseFolder = (path: string) => {
    const project = projectForFolder(sortedProjects, path);
    if (project) {
      setPickedFolder(null);
      setProjectChoice(project.id);
    } else {
      setPickedFolder(path);
      setProjectChoice(OTHER_FOLDER);
      setFolder(path);
    }
  };

  useEffect(() => {
    if (!pickedFolder) return;
    const project = projectForFolder(sortedProjects, pickedFolder);
    if (!project) return;
    setPickedFolder(null);
    setProjectChoice(project.id);
  }, [pickedFolder, sortedProjects]);

  const toggleFavorite = () => {
    if (!currentPath || !favorites.ready || favorites.saving) return;
    const label = chosenProject?.name || defaultFavoriteLabel(currentPath);
    void favorites.save((current) =>
      currentFavorite
        ? removeFavorite(current, currentPath)
        : addFavorite(current, currentPath, label),
    );
  };
  const canStart =
    choices !== null &&
    !starting &&
    // Starting now would throw away the recording or its pending transcript.
    dictation.state === "idle" &&
    message.trim().length > 0 &&
    (customFolder ? folderPath.length > 0 : projectChoice !== null);

  const update = (patch: Partial<CockpitLaunchSelection>) =>
    setSelection((current) => (current ? { ...current, ...patch } : current));

  const chooseProvider = (name: ProviderName) => {
    const next = launchable.find((provider) => provider.name === name);
    if (!next || !selection) return;
    setSelection(
      selectionForProvider(defaults, next, legacy, selection.permissionMode),
    );
  };

  /**
   * Upstream accepts a new session only through the durable creation request
   * (`session-creations`, upstream 085beaf0a): files are uploaded first as
   * staged attachments and travel with the first message. A fresh request ID
   * per attempt; when the reply is lost, the saved receipt is fetched once.
   * A failed upload leaves the form filled for another try. Every step uses
   * the host chosen at the start, even if the view switches hosts meanwhile.
   */
  const createSession = async (
    transport: SourceTransport,
    sourceKey: string,
    targetProjectId: string,
    text: string,
    options: SessionOptions,
  ): Promise<SessionCreationReceipt> => {
    const intent = JSON.stringify({
      targetProjectId,
      text,
      options,
      files: files.map((item) => item.id),
    });
    let attempt = unconfirmedCreation.current;
    if (attempt?.sourceKey !== sourceKey || attempt.intent !== intent) {
      const imageProfile = getAttachmentUploadProfile(
        attachmentQuality,
        providerInfo,
        options.model,
      );
      const staged: ComposerStagedAttachment[] = [];
      const batchId = generateUUID();
      try {
        for (const item of files) {
          staged.push(
            await uploadWithStallGuard(item.file, transport, {
              batchId,
              imageProfile,
              stalledMessage: t("cockpitUploadStalled"),
              onProgress: (percent) => {
                if (!mountedRef.current) return;
                setUploadProgress((current) => ({
                  ...current,
                  [item.id]: percent,
                }));
              },
            }),
          );
        }
      } catch (uploadError) {
        throw new Error(
          t("newSessionUploadError", {
            message:
              uploadError instanceof Error
                ? uploadError.message
                : String(uploadError),
          }),
        );
      } finally {
        revokeAttachmentPreviewUrls(staged);
      }
      attempt = {
        sourceKey,
        intent,
        requestId: generateUUID(),
        clientTimestamp: Date.now(),
        stagedAttachments: staged.map(toPersistedStagedAttachmentRef),
      };
      // Kept until the host answers for certain: a retry after a lost reply
      // sends the same request ID, so the host replays its saved receipt
      // instead of starting a second session.
      unconfirmedCreation.current = attempt;
    }
    const { requestId, clientTimestamp, stagedAttachments } = attempt;
    try {
      const receipt = await transport.fetch<SessionCreationReceipt>(
        `/projects/${encodeURIComponent(targetProjectId)}/session-creations`,
        {
          method: "POST",
          body: JSON.stringify({
            ...options,
            requestId,
            message: text,
            clientTimestamp,
            ...(stagedAttachments.length ? { stagedAttachments } : {}),
          }),
        },
      );
      unconfirmedCreation.current = null;
      return receipt;
    } catch (error) {
      // A refusal is final; a failed reply does not prove the host saved nothing.
      const refusal = error as { status?: number } | null;
      if (refusal?.status !== undefined && refusal.status < 500) {
        unconfirmedCreation.current = null;
        throw error;
      }
      const saved = await transport
        .fetch<SessionCreationReceipt>(
          `/session-creations/${encodeURIComponent(requestId)}`,
        )
        .catch(() => null);
      if (saved?.requestId === requestId && saved.sessionId) {
        unconfirmedCreation.current = null;
        return saved;
      }
      throw error;
    }
  };

  const start = async () => {
    if (!canStart || !choices) return;
    const transport = runtime.transport;
    const sourceKey = runtime.sourceKey;
    setStarting(true);
    setError(null);
    try {
      let targetProjectId = projectChoice;
      if (customFolder) {
        const added = await transport.fetch<{ project: { id: string } }>(
          "/projects",
          {
            method: "POST",
            body: JSON.stringify({ path: folderPath }),
          },
        );
        targetProjectId = added.project.id;
      }
      if (!targetProjectId) throw new Error(t("newSessionProjectNotFound"));
      const text = message.trim();
      const options = launchOptions(choices);
      const result = await createSession(
        transport,
        sourceKey,
        targetProjectId,
        text,
        options,
      );
      const remembered = rememberLaunch(defaults, choices.effective, legacy);
      if (remembered) {
        void updateSetting("newSessionDefaults", remembered).catch(() => {});
      }
      if (!mountedRef.current) return;
      navigate(navigation.session(result.projectId, result.sessionId), {
        state: createSessionNavigationState({
          initialTitle: text,
          initialModel: choices.effective.model ?? undefined,
          initialProvider:
            (result.provider as ProviderName | undefined) ??
            choices.effective.provider ??
            undefined,
        }),
      });
    } catch (err) {
      if (!mountedRef.current) return;
      // A sleeping or unreachable host surfaced as the bare "signal timed
      // out" (Joscha 29.09.2026); say what is going on instead.
      setError(
        isRequestDeadlineError(err) || isNetworkFailure(err)
          ? t("cockpitHostUnreachable")
          : err instanceof Error && err.message
            ? err.message
            : t("newSessionStartError"),
      );
      setUploadProgress({});
      setStarting(false);
    }
  };

  // Opened directly (an Android share or shortcut, a new tab) the form is
  // the first entry: going back would do nothing or leave the Cockpit.
  const cancel = () => {
    const historyIndex = (window.history.state as { idx?: unknown } | null)
      ?.idx;
    if (location.key === "default" || historyIndex === 0) {
      navigate(navigation.cockpit, { replace: true });
    } else {
      navigate(-1);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void start();
  };

  const onMessageKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.repeat ||
      event.keyCode === 229 ||
      event.nativeEvent.isComposing
    )
      return;
    // On touch keyboards Enter stays a line break; the button starts.
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    event.preventDefault();
    void start();
  };

  return (
    <>
      <form
        {...attachmentDrop.handlers}
        aria-labelledby="cockpit-new-session-title"
        className={styles.root}
        onSubmit={submit}
      >
        <header className={styles.header}>
          <p className={styles.eyebrow}>{t("cockpitNewSessionEyebrow")}</p>
          <h2 id="cockpit-new-session-title">{t("sidebarNewSession")}</h2>
        </header>

        <section className={styles.card}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={projectFieldId}>
              {t("newSessionProjectPathLabel")}
            </label>
            <div className={styles.folderRow}>
              <select
                className={styles.select}
                id={projectFieldId}
                onChange={(event) => {
                  setPickedFolder(null);
                  setProjectChoice(event.target.value);
                  if (event.target.value === OTHER_FOLDER) {
                    requestAnimationFrame(() => folderRef.current?.focus());
                  }
                }}
                value={projectChoice ?? ""}
              >
                {projectChoice === null && <option value="" />}
                {sortedProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {`${project.name} · ${shortPath(project.path)}`}
                  </option>
                ))}
                <option value={OTHER_FOLDER}>
                  {t("cockpitNewSessionOtherFolder")}
                </option>
              </select>
              <button
                aria-label={t("cockpitFolderPickerOpen")}
                className={styles.iconButton}
                onClick={() => setPickerOpen(true)}
                title={t("cockpitFolderPickerOpen")}
                type="button"
              >
                <FolderIcon />
              </button>
              <button
                aria-label={t(
                  currentFavorite
                    ? "cockpitProjectFavoriteRemove"
                    : "cockpitProjectFavoriteAdd",
                )}
                aria-pressed={currentFavorite !== undefined}
                className={styles.iconButton}
                data-favorite={currentFavorite ? "true" : undefined}
                disabled={!currentPath || !favorites.ready || favorites.saving}
                onClick={toggleFavorite}
                title={t(
                  currentFavorite
                    ? "cockpitProjectFavoriteRemove"
                    : "cockpitProjectFavoriteAdd",
                )}
                type="button"
              >
                <StarIcon />
              </button>
            </div>
            {customFolder && (
              <>
                <label className={styles.srOnly} htmlFor={folderFieldId}>
                  {t("newSessionProjectPathLabel")}
                </label>
                <input
                  autoCapitalize="off"
                  autoCorrect="off"
                  className={styles.input}
                  id={folderFieldId}
                  onChange={(event) => {
                    setPickedFolder(null);
                    setFolder(event.target.value);
                  }}
                  placeholder="~/Projects/…"
                  ref={folderRef}
                  spellCheck={false}
                  value={folder}
                />
              </>
            )}
          </div>

          <CockpitProjectFavorites
            controller={favorites}
            currentPath={currentPath}
            onChoose={(favorite) => chooseFolder(favorite.path)}
            onOpenMenu={favoriteMenu.open}
          />

          {launchable.length > 1 && selection && (
            <div className={styles.field}>
              <span className={styles.label}>
                {t("newSessionProviderTitle")}
              </span>
              <div
                aria-label={t("newSessionProviderTitle")}
                className={styles.providers}
                role="radiogroup"
              >
                {launchable.map((provider) => (
                  <button
                    aria-checked={provider.name === selection.provider}
                    className={styles.provider}
                    key={provider.name}
                    onClick={() => chooseProvider(provider.name)}
                    role="radio"
                    title={
                      provider.authenticated
                        ? undefined
                        : t("newSessionProviderStatusNotAuthenticated")
                    }
                    type="button"
                  >
                    {provider.displayName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {choices ? (
            <>
              <CockpitModelField
                models={choices.models}
                onChange={(model) => update({ model })}
                value={choices.effective.model}
              />
              {choices.supportsThinking && (
                <CockpitThinkingField
                  effort={choices.effective.effortLevel}
                  effortOptions={choices.effortOptions}
                  mode={choices.effective.thinkingMode}
                  modes={choices.thinkingModes}
                  onEffortChange={(effortLevel) => update({ effortLevel })}
                  onModeChange={(thinkingMode) => update({ thinkingMode })}
                />
              )}
              {choices.supportsPermissionMode && (
                <CockpitPermissionField
                  modes={choices.permissionModes}
                  onChange={(permissionMode) => update({ permissionMode })}
                  value={choices.effective.permissionMode}
                />
              )}
            </>
          ) : (
            <p className={styles.loading} role="status">
              {providersLoading || settings === null
                ? t("cockpitLoadingTitle")
                : t("cockpitNewSessionNoProvider")}
            </p>
          )}
        </section>

        <section className={styles.card}>
          <label className={styles.label} htmlFor={messageFieldId}>
            {t("cockpitNewSessionMessageLabel")}
          </label>
          <textarea
            className={styles.message}
            id={messageFieldId}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={onMessageKeyDown}
            onSelect={(event) => {
              messageSelectionRef.current = {
                start: event.currentTarget.selectionStart,
                end: event.currentTarget.selectionEnd,
              };
            }}
            placeholder={t("newSessionPlaceholder")}
            ref={messageRef}
            rows={5}
            value={message}
          />
          <div className={styles.attachRow}>
            <input
              className={styles.fileInput}
              multiple
              onChange={(event) => {
                attachFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
              ref={fileInputRef}
              tabIndex={-1}
              type="file"
            />
            <button
              className={styles.attachButton}
              disabled={starting}
              onClick={() => fileInputRef.current?.click()}
              title={t("cockpitComposerAttachmentHint")}
              type="button"
            >
              <PaperClipIcon />
              {t("toolbarAttachFiles")}
            </button>
            <CockpitDictationButton
              className={styles.dictationButton}
              dictation={dictation}
            />
            {files.length > 0 && (
              <ul
                aria-label={t("toolbarAttachFiles")}
                className={styles.attachments}
              >
                {files.map((item) => (
                  <li key={item.id}>
                    <span className={styles.fileName} title={item.file.name}>
                      {item.file.name}
                    </span>
                    {uploadProgress[item.id] !== undefined && (
                      <span className={styles.fileStatus}>
                        {uploadProgress[item.id]}%
                      </span>
                    )}
                    <button
                      aria-label={t("attachmentRemove", {
                        name: item.file.name,
                      })}
                      disabled={starting}
                      onClick={() =>
                        setFiles((current) =>
                          current.filter(
                            (candidate) => candidate.id !== item.id,
                          ),
                        )
                      }
                      type="button"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {dictation.error && (
            <p className={styles.error} role="alert">
              {dictation.error}
              {dictation.canRetry && (
                <>
                  {" "}
                  <button type="button" onClick={dictation.retry}>
                    {t("cockpitDictationRetry")}
                  </button>
                </>
              )}
            </p>
          )}
          <div className={styles.actions}>
            <button
              className={styles.secondary}
              disabled={starting}
              onClick={cancel}
              type="button"
            >
              {t("cockpitNewSessionCancel")}
            </button>
            <button
              className={styles.primary}
              disabled={!canStart}
              type="submit"
            >
              {starting
                ? t("cockpitNewSessionStarting")
                : t("newSessionStartAction")}
            </button>
          </div>
        </section>
        <CockpitAttachmentDropCue
          label={t("cockpitComposerDropFiles")}
          visible={attachmentDrop.draggingFiles}
        />
      </form>
      {/* Beside the form: the menu's rename field is a form of its own, and
          Enter in the picker's filter must not start the session. */}
      {favoriteMenu.element}
      {pickerOpen && (
        <CockpitFolderPicker
          initialPath={currentPath ?? undefined}
          onClose={() => setPickerOpen(false)}
          onPick={(path) => {
            setPickerOpen(false);
            chooseFolder(path);
          }}
        />
      )}
    </>
  );
}

/** fetch() rejects with a TypeError when the host cannot be reached at all. */
function isNetworkFailure(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    /failed to fetch|networkerror|load failed/i.test(error.message)
  );
}
