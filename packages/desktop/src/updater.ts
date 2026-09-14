import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUpdaterWindow } from "./tauri";

type Track = "stable" | "latest";
type CheckReason = "startup" | "periodic" | "manual";
interface CheckResult {
  track: Track;
  version: string | null;
  notes: string | null;
  waitingForStable: boolean;
}
interface Progress {
  downloadedBytes: number;
  totalBytes: number | null;
  installing: boolean;
}

let initialized = false;
let busy = false;
let generation = 0;
let track: Track = "stable";

export function initUpdater(): void {
  if (initialized) return;
  initialized = true;
  void listen("check-for-updates", () => void checkForUpdates("manual"));
  window.setTimeout(() => void checkForUpdates("startup"), 5_000);
  window.setInterval(
    () => void checkForUpdates("periodic"),
    24 * 60 * 60 * 1000,
  );
}

async function checkForUpdates(reason: CheckReason): Promise<void> {
  if (
    busy ||
    (reason !== "manual" && document.getElementById("desktop-updater-overlay"))
  )
    return;
  busy = true;
  const current = ++generation;
  try {
    track = await invoke<Track>("get_update_channel");
    if (reason === "manual")
      await showDialog("Checking for updates…", null, true);
    const result = await invoke<CheckResult>("check_update", { reason });
    if (current !== generation) return;
    if (result.version || reason === "manual") {
      await showDialog(
        result.version
          ? `Version ${result.version} is available.`
          : result.waitingForStable
            ? "Waiting for Stable to catch up. Your installed version is newer than the current Stable release."
            : "You are running the latest version on this channel.",
        result,
      );
    }
  } catch (error) {
    if (current === generation && reason === "manual") {
      await showDialog(`Failed to check for updates: ${String(error)}`);
    }
  } finally {
    busy = false;
  }
}

async function closeDialog(): Promise<void> {
  ++generation;
  document.getElementById("desktop-updater-overlay")?.remove();
  await invoke("clear_update");
}

async function showDialog(
  message: string,
  result: CheckResult | null = null,
  checking = false,
): Promise<void> {
  document.getElementById("desktop-updater-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "desktop-updater-overlay";
  overlay.innerHTML = `
    <div class="desktop-updater-dialog" role="dialog" aria-modal="true" aria-labelledby="desktop-updater-title">
      <h2 id="desktop-updater-title">Desktop updates</h2>
      <p><label for="desktop-update-channel">Update channel</label>
        <select id="desktop-update-channel" class="desktop-updater-btn" ${checking ? "disabled" : ""}>
          <option value="stable" ${track === "stable" ? "selected" : ""}>Stable</option>
          <option value="latest" ${track === "latest" ? "selected" : ""}>Latest (nightly)</option>
        </select>
      </p>
      <p>Latest includes verified development changes. Returning to Stable waits for a newer stable release; immediate rollback requires a manual reinstall.</p>
      <p role="status">${escapeHtml(message)}</p>
      ${result?.notes ? `<div class="desktop-updater-notes">${escapeHtml(result.notes)}</div>` : ""}
      <div class="desktop-updater-progress" hidden>
        <div class="desktop-updater-progress-bar"><div class="desktop-updater-progress-fill"></div></div>
        <p class="desktop-updater-status">Downloading…</p>
      </div>
      <div class="desktop-updater-actions">
        ${result?.version ? '<button class="desktop-updater-btn primary" data-action="install">Update and restart</button>' : ""}
        ${!checking && !result?.version ? '<button class="desktop-updater-btn" data-action="retry">Check again</button>' : ""}
        <button class="desktop-updater-btn" data-action="close">${result?.version ? "Later" : "Close"}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const select = overlay.querySelector("select") as HTMLSelectElement;
  select.addEventListener("change", () => {
    void (async () => {
      if (busy) return;
      busy = true;
      select.disabled = true;
      const selection = ++generation;
      try {
        await invoke("set_update_channel", { track: select.value });
        if (selection !== generation) return;
        track = select.value as Track;
      } catch (error) {
        if (selection === generation)
          await showDialog(`Could not change channel: ${String(error)}`);
        return;
      } finally {
        busy = false;
      }
      await checkForUpdates("manual");
    })();
  });
  overlay
    .querySelector('[data-action="close"]')
    ?.addEventListener("click", () => void closeDialog());
  overlay
    .querySelector('[data-action="retry"]')
    ?.addEventListener("click", () => void checkForUpdates("manual"));
  overlay
    .querySelector('[data-action="install"]')
    ?.addEventListener("click", () => void installUpdate(overlay));
  try {
    await openUpdaterWindow();
  } catch (error) {
    // Preserve the result even when native window activation fails.
    console.error("Failed to activate updater window:", error);
  }
}

async function installUpdate(overlay: HTMLElement): Promise<void> {
  if (busy) return;
  busy = true;
  const actions = overlay.querySelector(
    ".desktop-updater-actions",
  ) as HTMLElement;
  const select = overlay.querySelector("select") as HTMLSelectElement;
  const progressElement = overlay.querySelector(
    ".desktop-updater-progress",
  ) as HTMLElement;
  const fill = overlay.querySelector(
    ".desktop-updater-progress-fill",
  ) as HTMLElement;
  const status = overlay.querySelector(
    ".desktop-updater-status",
  ) as HTMLElement;
  actions.style.display = "none";
  select.disabled = true;
  progressElement.hidden = false;
  const progress = new Channel<Progress>();
  progress.onmessage = (event) => {
    if (event.installing) {
      fill.style.width = "100%";
      status.textContent = "Installing…";
    } else if (event.totalBytes) {
      fill.style.width = `${Math.min(100, (event.downloadedBytes / event.totalBytes) * 100)}%`;
    }
  };
  try {
    await invoke("install_update", { progress });
    await relaunch();
  } catch (error) {
    await showDialog(`Update failed: ${String(error)}`);
  } finally {
    busy = false;
  }
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
