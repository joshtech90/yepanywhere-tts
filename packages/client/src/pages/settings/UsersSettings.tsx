import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  LimitedUserSummary,
  ProjectAccessLevel,
  UsageReport,
} from "@yep-anywhere/shared";
import {
  JOIN_STALE_OFFSET_MAX_MINUTES,
  JOIN_STALE_OFFSET_MIN_MINUTES,
} from "@yep-anywhere/shared";
import { api } from "../../api/client";
import { useActingPrincipal } from "../../hooks/useActingPrincipal";
import { useProjects } from "../../hooks/useProjects";
import { useProviders } from "../../hooks/useProviders";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useI18n } from "../../i18n";
import { SettingsItem } from "./SettingsItem";
import { useSettingsPaneTitle } from "./SettingsPaneTitleContext";
import { SettingsSection } from "./SettingsSection";
import { UserUsageTable } from "./UserUsageTable";
import styles from "./UsersSettings.module.css";

/**
 * Settings → Users: the superuser's user-management surface.
 *
 * Contract: topics/limited-users.md § Delivery v1 — Settings → Users. This is
 * the only place limited users are created, edited, and removed; creating the
 * first one turns the feature on. Everything here is presentation — the server
 * enforces the same grants at the operation, so a hidden control is never the
 * protection.
 */

const EFFORT_OPTIONS = ["low", "medium", "high", "xhigh", "max"] as const;

interface DraftState {
  username: string;
  password: string;
  access: Record<string, ProjectAccessLevel>;
  joinStaleOffsetMinutes: number;
  provider: string;
  model: string;
  effort: string;
  projectRoot: string;
}

const EMPTY_DRAFT: DraftState = {
  username: "",
  password: "",
  access: {},
  joinStaleOffsetMinutes: 0,
  provider: "",
  model: "",
  effort: "",
  projectRoot: "",
};

function draftFromUser(user: LimitedUserSummary): DraftState {
  const access: Record<string, ProjectAccessLevel> = {};
  for (const id of user.viewProjects) access[id] = "view";
  for (const id of user.joinProjects) access[id] = "join";
  for (const id of user.newSessionProjects) access[id] = "new-session";
  return {
    username: user.username,
    password: "",
    access,
    joinStaleOffsetMinutes: user.joinStaleOffsetMinutes,
    provider: user.lock.provider ?? "",
    model: user.lock.model ?? "",
    effort: user.lock.effort ?? "",
    projectRoot: user.projectRoot ?? "",
  };
}

function grantsFromDraft(draft: DraftState) {
  const newSessionProjects: string[] = [];
  const joinProjects: string[] = [];
  const viewProjects: string[] = [];
  for (const [projectId, level] of Object.entries(draft.access)) {
    if (level === "new-session") newSessionProjects.push(projectId);
    else if (level === "join") joinProjects.push(projectId);
    else if (level === "view") viewProjects.push(projectId);
  }
  return {
    newSessionProjects,
    joinProjects,
    viewProjects,
    joinStaleOffsetMinutes: draft.joinStaleOffsetMinutes,
    lock: {
      ...(draft.provider ? { provider: draft.provider } : {}),
      ...(draft.model ? { model: draft.model } : {}),
      ...(draft.effort ? { effort: draft.effort } : {}),
    },
    // Always sent, so clearing the field revokes the grant.
    projectRoot: draft.projectRoot.trim(),
  };
}

/** The lock as one readable phrase, or null when nothing is locked. */
function lockSummary(user: LimitedUserSummary): string | null {
  const parts = [user.lock.provider, user.lock.model, user.lock.effort].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

type EditorTarget = { kind: "create" } | { kind: "edit"; username: string };

export function UsersSettings() {
  const { t } = useI18n();
  useSettingsPaneTitle(t("settingsUsersTitle"));
  const {
    settings,
    updateSetting,
    isLoading: settingsLoading,
  } = useServerSettings();
  const {
    principal,
    resolved: principalResolved,
    refresh: refreshPrincipal,
  } = useActingPrincipal();

  const [users, setUsers] = useState<LimitedUserSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** Null while unknown; false once the server answers that it has no surface. */
  const [supported, setSupported] = useState<boolean | null>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<UsageReport | null>(null);

  // Acting as a limited user, every /api/users call but /me and /logout is
  // refused, which is the point: they manage nobody.
  const canManage = principal.superuser && !principal.switched;

  const loadUsers = useCallback(async () => {
    // Until the server says who this client is, the hook reports the
    // superuser placeholder. Asking now would send one refused request on
    // every load for a switched superuser or a limited user.
    if (!principalResolved) return;
    if (!canManage) {
      setLoaded(true);
      return;
    }
    try {
      const response = await api.listUsers();
      setUsers(response.users);
      setSupported(true);
    } catch (loadError) {
      // Only a missing route means the server lacks the surface. A refusal
      // means it has one and this principal may not use it, which the
      // acting-principal branches above already handle.
      const status = (loadError as { status?: number }).status;
      setSupported(status !== 404);
      setError((loadError as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [canManage, principalResolved]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  // Usage is its own read: a server without the ledger 404s here while the
  // directory above still works, and the table simply does not appear.
  const loadUsage = useCallback(async () => {
    if (!principalResolved || !canManage) return;
    try {
      setUsage(await api.getUserUsage());
    } catch {
      setUsage(null);
    }
  }, [canManage, principalResolved]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const enabled = settings?.limitedUsersEnabled === true;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const grants = grantsFromDraft(draft);
      if (editor?.kind === "edit") {
        await api.updateUser(editor.username, {
          ...grants,
          ...(draft.password ? { password: draft.password } : {}),
        });
      } else {
        await api.createUser({
          username: draft.username,
          password: draft.password,
          ...grants,
        });
      }
      setDraft(EMPTY_DRAFT);
      setEditor(null);
      await loadUsers();
      // Creating the first user turns the feature on server-side; re-read so
      // this pane and the acting principal agree without a reload.
      await refreshPrincipal();
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (username: string) => {
    if (!window.confirm(t("usersDeleteConfirm", { username }))) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteUser(username);
      setEditor(null);
      setDraft(EMPTY_DRAFT);
      await loadUsers();
    } catch (deleteError) {
      setError((deleteError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const switchTo = async (username: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.switchUser(username);
      // Acting as a different principal changes every list in the app.
      window.location.reload();
    } catch (switchError) {
      setError((switchError as Error).message);
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      const result = await api.logoutUser();
      if (result.redirect === "relay-login")
        window.location.href = "/login/relay";
      else if (result.redirect === "direct-login")
        window.location.href = "/login";
      else window.location.reload();
    } catch (logoutError) {
      setError((logoutError as Error).message);
      setBusy(false);
    }
  };

  // Rendering the directory before the identity lands would flash the
  // superuser's pane at a limited user on every load.
  if (!principalResolved) {
    return <SettingsSection description={t("loading")} />;
  }

  if (!canManage) {
    return <LimitedUserView onLogout={() => void logout()} busy={busy} />;
  }

  if (supported === false) {
    return (
      <SettingsSection
        title={t("settingsUsersTitle")}
        description={t("settingsUsersDescription")}
      >
        <p className="settings-hint">{t("usersUnsupportedServer")}</p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title={t("settingsUsersTitle")}
      description={t("settingsUsersDescription")}
      keywords={["limited users", "accounts", "guest", "sandbox", "grants"]}
    >
      {/* First, because it is the decision the rest of the pane depends on.
          Turning it off keeps the records and refuses their logins. */}
      <SettingsItem
        label={t("advancedLimitedUsersTitle")}
        description={t("advancedLimitedUsersDescription")}
        keywords={["limited users", "accounts", "enable", "disable"]}
      >
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={enabled}
            disabled={settingsLoading || busy}
            onChange={(event) =>
              void updateSetting("limitedUsersEnabled", event.target.checked)
            }
          />
          <span className="toggle-slider" />
        </label>
      </SettingsItem>

      <div className="settings-group">
        {loaded && users.length === 0 ? (
          <p className="settings-hint">{t("usersEmpty")}</p>
        ) : (
          <ul className={styles.userList}>
            {users.map((user) => {
              const lock = lockSummary(user);
              return (
                <li key={user.username} className={styles.userRow}>
                  <div className={styles.userInfo}>
                    <strong className={styles.userName}>{user.username}</strong>
                    <span className={styles.userMeta}>
                      {t("usersGrantSummary", {
                        newSession: user.newSessionProjects.length,
                        join: user.joinProjects.length,
                        view: user.viewProjects.length,
                      })}
                      {lock ? ` · ${lock}` : ""}
                    </span>
                  </div>
                  <div className={styles.userActions}>
                    <button
                      type="button"
                      className="settings-button"
                      disabled={busy}
                      onClick={() => void switchTo(user.username)}
                    >
                      {t("usersActAs")}
                    </button>
                    <button
                      type="button"
                      className="settings-button"
                      disabled={busy}
                      onClick={() => {
                        setEditor({ kind: "edit", username: user.username });
                        setDraft(draftFromUser(user));
                      }}
                    >
                      {t("usersEdit")}
                    </button>
                    <button
                      type="button"
                      className="settings-button settings-button-danger-subtle"
                      disabled={busy}
                      onClick={() => void remove(user.username)}
                    >
                      {t("usersDelete")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {editor === null && (
          <button
            type="button"
            className="settings-button"
            disabled={busy}
            onClick={() => {
              setEditor({ kind: "create" });
              setDraft(EMPTY_DRAFT);
            }}
          >
            {t("usersAddUser")}
          </button>
        )}
      </div>

      {editor !== null && (
        <UserEditor
          editing={editor.kind === "edit" ? editor.username : null}
          draft={draft}
          error={error}
          busy={busy}
          onDraftChange={setDraft}
          onSubmit={() => void submit()}
          onCancel={() => {
            setEditor(null);
            setDraft(EMPTY_DRAFT);
            setError(null);
          }}
        />
      )}

      {error && editor === null && <p className="form-error">{error}</p>}

      {usage && <UserUsageTable report={usage} />}
    </SettingsSection>
  );
}

/** What a limited user (or a switched superuser) sees here: their own row. */
function LimitedUserView({
  onLogout,
  busy,
}: {
  onLogout: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const { principal } = useActingPrincipal();
  const grants = principal.grants;
  const lock = grants
    ? [grants.lock.provider, grants.lock.model, grants.lock.effort]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <SettingsSection
      title={t("settingsUsersTitle")}
      description={t("usersOwnAccountDescription")}
    >
      <div className="settings-group">
        <dl className={styles.grants}>
          <dt>{t("usersSignedInAs")}</dt>
          <dd>{principal.username}</dd>
          {grants && (
            <>
              <dt>{t("usersGrantNewSession")}</dt>
              <dd>{grants.newSessionProjects.length}</dd>
              <dt>{t("usersGrantJoin")}</dt>
              <dd>{grants.joinProjects.length}</dd>
              <dt>{t("usersGrantView")}</dt>
              <dd>{grants.viewProjects.length}</dd>
            </>
          )}
          {lock && (
            <>
              <dt>{t("usersGrantLock")}</dt>
              <dd>{lock}</dd>
            </>
          )}
        </dl>
        <button
          type="button"
          className="settings-button"
          disabled={busy}
          onClick={onLogout}
        >
          {principal.switched ? t("usersReturnToSuperuser") : t("usersLogout")}
        </button>
      </div>
    </SettingsSection>
  );
}

interface UserEditorProps {
  /** The username being edited, or null when creating. */
  editing: string | null;
  draft: DraftState;
  error: string | null;
  busy: boolean;
  onDraftChange: (draft: DraftState) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

function UserEditor({
  editing,
  draft,
  error,
  busy,
  onDraftChange,
  onSubmit,
  onCancel,
}: UserEditorProps) {
  const { t } = useI18n();
  const { projects } = useProjects();
  const { providers } = useProviders();

  const models = useMemo(() => {
    const provider = providers.find((entry) => entry.name === draft.provider);
    return provider?.models ?? [];
  }, [providers, draft.provider]);

  return (
    <div className={`settings-group ${styles.editor}`}>
      <h3 className={styles.editorTitle}>
        {editing
          ? t("usersEditUserTitle", { username: editing })
          : t("usersAddUser")}
      </h3>

      {!editing && (
        <label className={styles.field}>
          <span>{t("usersUsernameLabel")}</span>
          <input
            className={styles.input}
            value={draft.username}
            placeholder={t("usersUsernamePlaceholder")}
            autoComplete="off"
            onChange={(event) =>
              onDraftChange({ ...draft, username: event.target.value })
            }
          />
        </label>
      )}
      <label className={styles.field}>
        <span>
          {editing ? t("usersNewPasswordLabel") : t("usersPasswordLabel")}
        </span>
        <input
          className={styles.input}
          type="password"
          value={draft.password}
          placeholder={
            editing
              ? t("usersNewPasswordPlaceholder")
              : t("usersPasswordPlaceholder")
          }
          autoComplete="new-password"
          onChange={(event) =>
            onDraftChange({ ...draft, password: event.target.value })
          }
        />
      </label>

      <p className={styles.subhead}>{t("usersProjectsHeading")}</p>
      {projects.length === 0 ? (
        <p className="settings-hint">{t("usersNoProjects")}</p>
      ) : (
        <ul className={styles.projectList}>
          {projects.map((project) => (
            <li key={project.id} className={styles.projectRow}>
              <span className={styles.projectName} title={project.path}>
                {project.name}
              </span>
              <select
                className={styles.select}
                value={draft.access[project.id] ?? "none"}
                aria-label={project.name}
                onChange={(event) =>
                  onDraftChange({
                    ...draft,
                    access: {
                      ...draft.access,
                      [project.id]: event.target.value as ProjectAccessLevel,
                    },
                  })
                }
              >
                <option value="none">{t("usersAccessNone")}</option>
                <option value="view">{t("usersAccessView")}</option>
                <option value="join">{t("usersAccessJoin")}</option>
                <option value="new-session">
                  {t("usersAccessNewSession")}
                </option>
              </select>
            </li>
          ))}
        </ul>
      )}

      <p className={styles.subhead}>{t("usersProjectRootHeading")}</p>
      <label className={styles.field}>
        <span>{t("usersProjectRootLabel")}</span>
        <input
          className={styles.input}
          value={draft.projectRoot}
          placeholder={t("usersProjectRootPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) =>
            onDraftChange({ ...draft, projectRoot: event.target.value })
          }
        />
      </label>
      <p className="settings-hint">{t("usersProjectRootHint")}</p>

      <label className={styles.field}>
        <span>{t("usersJoinOffsetLabel")}</span>
        <input
          className={styles.input}
          type="number"
          min={JOIN_STALE_OFFSET_MIN_MINUTES}
          max={JOIN_STALE_OFFSET_MAX_MINUTES}
          value={draft.joinStaleOffsetMinutes}
          onChange={(event) =>
            onDraftChange({
              ...draft,
              joinStaleOffsetMinutes: Number(event.target.value),
            })
          }
        />
      </label>
      <p className="settings-hint">{t("usersJoinOffsetHint")}</p>

      <p className={styles.subhead}>{t("usersLockHeading")}</p>
      <p className="settings-hint">{t("usersLockHint")}</p>
      <div className={styles.lockRow}>
        <label className={styles.field}>
          <span>{t("usersLockProvider")}</span>
          <select
            className={styles.select}
            value={draft.provider}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                provider: event.target.value,
                model: "",
              })
            }
          >
            <option value="">{t("usersLockUnset")}</option>
            {providers.map((provider) => (
              <option key={provider.name} value={provider.name}>
                {provider.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t("usersLockModel")}</span>
          <select
            className={styles.select}
            value={draft.model}
            disabled={!draft.provider}
            onChange={(event) =>
              onDraftChange({ ...draft, model: event.target.value })
            }
          >
            <option value="">{t("usersLockUnset")}</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>{t("usersLockEffort")}</span>
          <select
            className={styles.select}
            value={draft.effort}
            onChange={(event) =>
              onDraftChange({ ...draft, effort: event.target.value })
            }
          >
            <option value="">{t("usersLockUnset")}</option>
            {EFFORT_OPTIONS.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="form-error">{error}</p>}
      <div className={styles.editorActions}>
        <button
          type="button"
          className="settings-button settings-button-primary"
          disabled={busy}
          onClick={onSubmit}
        >
          {editing ? t("usersSaveUser") : t("usersCreateUser")}
        </button>
        <button
          type="button"
          className="settings-button"
          disabled={busy}
          onClick={onCancel}
        >
          {t("usersCancel")}
        </button>
      </div>
    </div>
  );
}
