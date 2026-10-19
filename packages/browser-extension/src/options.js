// Chrome's "Extension options" entry. The options live in YA Settings, under
// the default host's route, so open that in this tab (docs/tactical/151).

(async () => {
  const stored = await chrome.storage.local.get([
    "ya.savedHosts",
    "ya.extension.settings",
  ]);
  const hosts = (stored["ya.savedHosts"] ?? []).filter(
    (host) => host.mode === "relay" && host.relayUsername,
  );
  const settings = stored["ya.extension.settings"] ?? {};
  const active = Array.isArray(settings.activeHostIds)
    ? hosts.filter((host) => settings.activeHostIds.includes(host.id))
    : hosts;
  const host =
    active.find((candidate) => candidate.id === settings.defaultHostId) ??
    active[0] ??
    hosts[0];
  location.replace(
    host
      ? `/-/relay/${encodeURIComponent(host.relayUsername)}/settings/browser-extension`
      : "/login",
  );
})();
