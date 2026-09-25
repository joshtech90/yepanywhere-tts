const COCKPIT_ORGANIZATION_KEY = "yep-anywhere-cockpit-organization";
const COCKPIT_ORGANIZATION_VERSION = 1;

export interface CockpitSavedView {
  id: string;
  label: string;
  query: string;
  pinnedOnly: boolean;
}

export interface CockpitOrganizationState {
  activeViewId: string | null;
  views: CockpitSavedView[];
}

interface CockpitOrganizationRecord {
  version: 1;
  sources: Record<
    string,
    {
      activeViewId?: string;
      views: CockpitSavedView[];
    }
  >;
}

function isSavedView(value: unknown): value is CockpitSavedView {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CockpitSavedView>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.label === "string" &&
    candidate.label.length > 0 &&
    typeof candidate.query === "string" &&
    typeof candidate.pinnedOnly === "boolean"
  );
}

function readRecord(): CockpitOrganizationRecord | null {
  try {
    const raw = localStorage.getItem(COCKPIT_ORGANIZATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CockpitOrganizationRecord>;
    if (
      parsed.version !== COCKPIT_ORGANIZATION_VERSION ||
      !parsed.sources ||
      typeof parsed.sources !== "object"
    ) {
      return null;
    }
    return parsed as CockpitOrganizationRecord;
  } catch {
    return null;
  }
}

function writeSourceState(
  sourceKey: string,
  state: CockpitOrganizationState,
): void {
  try {
    const current = readRecord();
    const sources = current?.sources ?? {};
    const record: CockpitOrganizationRecord = {
      version: COCKPIT_ORGANIZATION_VERSION,
      sources: {
        ...sources,
        [sourceKey]: {
          ...(state.activeViewId ? { activeViewId: state.activeViewId } : {}),
          views: state.views,
        },
      },
    };
    localStorage.setItem(COCKPIT_ORGANIZATION_KEY, JSON.stringify(record));
  } catch {
    // Saved views are optional; catalog navigation stays available.
  }
}

export function readCockpitOrganization(
  sourceKey: string,
): CockpitOrganizationState {
  const source = readRecord()?.sources[sourceKey];
  if (!source || !Array.isArray(source.views)) {
    return { activeViewId: null, views: [] };
  }
  const views = source.views.filter(isSavedView).slice(0, 12);
  const activeViewId = views.some((view) => view.id === source.activeViewId)
    ? (source.activeViewId ?? null)
    : null;
  return { activeViewId, views };
}

export function saveCockpitView(
  sourceKey: string,
  input: Omit<CockpitSavedView, "id"> & { id?: string },
): CockpitOrganizationState {
  const current = readCockpitOrganization(sourceKey);
  const duplicate = current.views.find(
    (view) =>
      view.query === input.query && view.pinnedOnly === input.pinnedOnly,
  );
  const view: CockpitSavedView = duplicate ?? {
    id:
      input.id ??
      `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: input.label,
    query: input.query,
    pinnedOnly: input.pinnedOnly,
  };
  const views = duplicate
    ? current.views.map((candidate) =>
        candidate.id === duplicate.id
          ? { ...candidate, label: input.label }
          : candidate,
      )
    : [view, ...current.views].slice(0, 12);
  const next = { activeViewId: view.id, views };
  writeSourceState(sourceKey, next);
  return next;
}

export function activateCockpitView(
  sourceKey: string,
  activeViewId: string | null,
): CockpitOrganizationState {
  const current = readCockpitOrganization(sourceKey);
  const next = {
    ...current,
    activeViewId: current.views.some((view) => view.id === activeViewId)
      ? activeViewId
      : null,
  };
  writeSourceState(sourceKey, next);
  return next;
}

export function removeCockpitView(
  sourceKey: string,
  viewId: string,
): CockpitOrganizationState {
  const current = readCockpitOrganization(sourceKey);
  const next = {
    activeViewId: current.activeViewId === viewId ? null : current.activeViewId,
    views: current.views.filter((view) => view.id !== viewId),
  };
  writeSourceState(sourceKey, next);
  return next;
}

export function removeCockpitOrganizationSource(sourceKey: string): void {
  try {
    const current = readRecord();
    if (!current?.sources[sourceKey]) return;
    const sources = { ...current.sources };
    delete sources[sourceKey];
    localStorage.setItem(
      COCKPIT_ORGANIZATION_KEY,
      JSON.stringify({
        version: COCKPIT_ORGANIZATION_VERSION,
        sources,
      } satisfies CockpitOrganizationRecord),
    );
  } catch {
    // Host removal must still succeed if browser storage is unavailable.
  }
}
