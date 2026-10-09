/** Page invariants, separate from experiment completion and timing diagnostics. */
export function assessPageRecovery(result) {
  const failures = [];
  if (!result.completed)
    failures.push("Experiment or cleanup did not complete");
  if (result.client === "android" && !result.instrumentationPassed)
    failures.push("Native instrumentation did not finish successfully");
  const final = result.final;
  if (!result.firstHealthyAt || result.firstHealthyAt < result.restoredAt)
    failures.push("No complete recovery observed after restoration");
  if (
    !final ||
    final.connection ||
    final.errors ||
    final.login ||
    final.bodyEmpty
  )
    failures.push(
      "Final page is offline, empty, at sign-in, or showing an error",
    );
  if (result.expectedPath && final?.path !== result.expectedPath)
    failures.push("Recovery changed the requested page");
  if (!final?.titleUpdated) failures.push("Session title did not catch up");
  if (result.surface === "session") {
    if (!final?.needle)
      failures.push("Missed transcript message did not catch up");
    const draft = result.expectedDraft ?? "Draft survives outage";
    if (final?.draft !== draft)
      failures.push("Unsent draft changed or disappeared");
    if (
      result.expectedAttachment &&
      !final?.attachmentNames?.includes(result.expectedAttachment)
    )
      failures.push("Unsent draft attachment disappeared");
  }
  if (!result.sidebar?.sidebar?.includes("Updated study"))
    failures.push("Opened sidebar does not show the updated session title");
  const rows = result.observer?.rows;
  if (!rows?.length) failures.push("Page transition observations are missing");
  for (const row of rows ?? []) {
    if (row.at < result.faultAt) continue;
    if (row.errors) failures.push(`Transient page error: ${row.errors}`);
    if (row.login || /(?:^|\/)login(?:\/|$)/.test(row.path ?? ""))
      failures.push("Temporary outage redirected to sign-in");
    if (row.bodyEmpty && !row.initializing)
      failures.push("Page became empty during recovery");
  }
  if (
    result.client === "android" &&
    result.nativeDiagnosticsAvailable === false
  )
    failures.push("Native diagnostic evidence is unavailable");
  if (result.surface === "session") {
    const draft = result.expectedDraft ?? "Draft survives outage";
    const keys = result.observer?.keys ?? [];
    if (
      [...draft].some(
        (_, index) =>
          !keys.some((key) => key.value === draft.slice(0, index + 1)),
      )
    )
      failures.push("Sequential input did not acknowledge every character");
    if (
      keys.some(
        (key) =>
          !Number.isFinite(key.frameDelayMs) ||
          !Number.isFinite(key.eventDelayMs) ||
          key.frameDelayMs + key.eventDelayMs > 100,
      )
    )
      failures.push("Input acknowledgement exceeded 100 ms");
  }
  if (result.sidebar?.errors || result.sidebar?.login)
    failures.push("Sidebar inspection exposed an error or sign-in");
  if (result.pageErrors?.length)
    failures.push("Uncaught page exception during the experiment");
  if (result.nativeSyntheticErrors?.length)
    failures.push("Native fabricated server error responses");
  return { passed: failures.length === 0, failures: [...new Set(failures)] };
}
