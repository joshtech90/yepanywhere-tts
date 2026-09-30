import {
  SERVER_CAPABILITIES,
  serverHasCapability,
  type ProjectAppInventory,
} from "@yep-anywhere/shared";
import { useEffect, useState } from "react";
import { projectAppApi } from "../../api/projectApp";
import { ProjectAppViewer } from "../../components/ProjectAppViewer";
import { useVersion } from "../../hooks/useVersion";
import { useI18n } from "../../i18n";
import styles from "./ProjectAppInventorySection.module.css";
import { SettingsCollection } from "./SettingsCollection";

/** Project apps and retained names beside the operator's manual port forwards. */
export function ProjectAppInventorySection() {
  const { version } = useVersion();
  const { t } = useI18n();
  const supported = serverHasCapability(
    version,
    SERVER_CAPABILITIES.projectAppInventory.name,
  );
  const [inventory, setInventory] = useState<ProjectAppInventory | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh and address release deliberately invalidate the inventory through revision.
  useEffect(() => {
    if (!supported) return;
    let active = true;
    setLoading(true);
    setError("");
    void projectAppApi
      .inventory()
      .then((next) => {
        if (active) setInventory(next);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [supported, revision]);
  const knownProjects = new Set(
    inventory?.projects.map((row) => row.projectId),
  );
  const selected = inventory?.projects.find(
    (row) => row.projectId === expanded,
  );
  const retained =
    inventory?.reservations.filter(
      (row) => !knownProjects.has(row.projectId),
    ) ?? [];
  async function releaseAddress(
    row: ProjectAppInventory["reservations"][number],
  ) {
    if (
      !window.confirm(
        t("projectAppReleaseConfirm", {
          address: `${row.name}.${row.namespace}`,
        }),
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await projectAppApi.releaseAddress(row.projectId, row.namespace);
      setRevision((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={styles.inventory}
      aria-label={t("projectAppInventoryTitle")}
    >
      <div className={styles.heading}>
        <h3>{t("projectAppInventoryTitle")}</h3>
        {supported && (
          <button
            type="button"
            disabled={loading || busy}
            onClick={() => setRevision((value) => value + 1)}
          >
            {t("projectAppInventoryRefresh")}
          </button>
        )}
      </div>
      <p>
        {t(supported ? "projectAppInventoryHint" : "projectAppInventoryUpdate")}
      </p>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">{t("projectAppLoading")}</p>}
      {supported && inventory && (
        <>
          {inventory.projects.length === 0 && retained.length === 0 && (
            <p>{t("projectAppInventoryEmpty")}</p>
          )}
          <SettingsCollection
            selectedKey={selected?.projectId ?? null}
            title={selected?.name ?? ""}
            onClose={() => setExpanded(undefined)}
            detail={inventory.projects.map(
              (row) =>
                expanded === row.projectId && (
                  <article className={styles.row} key={row.projectId}>
                    <div className={styles.heading}>
                      <span>
                        {t("projectAppState", { state: row.info.state })}
                      </span>
                    </div>
                    <p>
                      {row.owner ?? t("projectAppInventoryAdministrator")} ·{" "}
                      <code>{row.path}</code>
                    </p>
                    {inventory.reservations
                      .filter((address) => address.projectId === row.projectId)
                      .map((address) => (
                        <p key={address.namespace}>
                          <strong>
                            {address.name}.{address.namespace}
                          </strong>
                          {!version?.artifactViewer?.vhostPublicRoot && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void releaseAddress(address)}
                            >
                              {t("projectAppRelease")}
                            </button>
                          )}
                        </p>
                      ))}
                    {expanded === row.projectId && (
                      <ProjectAppViewer
                        key={`${row.projectId}:${revision}`}
                        projectId={row.projectId}
                        presentation="settings"
                        onAddressesChanged={(addresses) =>
                          setInventory((current) =>
                            current && addresses.enabled
                              ? {
                                  ...current,
                                  reservations: [
                                    ...current.reservations.filter(
                                      (address) =>
                                        address.projectId !== row.projectId,
                                    ),
                                    ...addresses.reservations.map(
                                      (address) => ({
                                        ...address,
                                        projectId: row.projectId,
                                      }),
                                    ),
                                  ],
                                }
                              : current,
                          )
                        }
                        onInfoChanged={(info) =>
                          setInventory(
                            (current) =>
                              current && {
                                ...current,
                                projects: current.projects.map((project) =>
                                  project.projectId === row.projectId
                                    ? { ...project, info }
                                    : project,
                                ),
                              },
                          )
                        }
                      />
                    )}
                  </article>
                ),
            )}
          >
            <table aria-label={t("projectAppInventoryTitle")}>
              <thead>
                <tr>
                  <th scope="col">{t("settingsCollectionProject")}</th>
                  <th scope="col">{t("settingsCollectionDomain")}</th>
                  <th scope="col">{t("settingsCollectionStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {inventory.projects.map((row) => (
                  <tr key={row.projectId}>
                    <td>
                      <button
                        type="button"
                        aria-expanded={expanded === row.projectId}
                        onClick={() =>
                          setExpanded(
                            expanded === row.projectId
                              ? undefined
                              : row.projectId,
                          )
                        }
                      >
                        <span aria-hidden="true">
                          {expanded === row.projectId ? "▾" : "▸"}{" "}
                        </span>
                        {row.name}
                      </button>
                    </td>
                    <td>
                      {inventory.reservations
                        .filter(
                          (address) => address.projectId === row.projectId,
                        )
                        .map((address) => (
                          <div key={address.namespace}>
                            {address.name}.{address.namespace}
                          </div>
                        ))}
                    </td>
                    <td>{t("projectAppState", { state: row.info.state })}</td>
                  </tr>
                ))}
                {retained.map((row) => (
                  <tr key={`${row.projectId}:${row.namespace}`}>
                    <td>
                      {t("projectAppInventoryUnavailable", {
                        owner: row.owner,
                      })}
                    </td>
                    <td>
                      {row.name}.{row.namespace}
                    </td>
                    <td>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void releaseAddress(row)}
                      >
                        {t("projectAppRelease")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SettingsCollection>
        </>
      )}
    </section>
  );
}
