import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  SessionContentDiagnostic,
  SessionContentMatch,
} from "@yep-anywhere/shared";
import { useCurrentSourceRuntime } from "../../contexts/SourceRuntimeContext";
import type { GlobalSessionItem } from "../../api/client";
import { inTimeRange, type SearchField } from "./model";
import {
  ContentSearchPool,
  ContentSearchScan,
  MIN_TURN_SEARCH_QUERY_LENGTH,
  scanDone,
  scanHasCompletePass,
  scanLimited,
} from "./ContentSearchScan";

const EMPTY_MATCHES = new Map<string, SessionContentMatch[]>();
const EMPTY_PARTIAL = new Map<string, string>();
const EMPTY_DIAGNOSTICS = new Map<string, SessionContentDiagnostic[]>();

export function useContentSearch(
  sessions: GlobalSessionItem[],
  query: string,
  fields: SearchField[],
  enabled: boolean,
  after?: number,
  before?: number,
  viewportRows = Infinity,
) {
  const runtime = useCurrentSourceRuntime();
  const [pool] = useState(() => new ContentSearchPool());
  const assistant = fields.includes("assistant");
  const user = fields.includes("user");
  const roles = useMemo(
    () => [
      ...(assistant ? ["assistant" as const] : []),
      ...(user ? ["user" as const] : []),
    ],
    [assistant, user],
  );
  const owner = useRef<{
    key: string;
    scans: ContentSearchScan[];
    wanted: Map<string, string>;
    query: string;
  }>({ key: "", scans: [], wanted: new Map(), query });
  // Once initiated, keep both roles live for this needle even while unchecked.
  const active =
    enabled &&
    [...query.trim()].length >= MIN_TURN_SEARCH_QUERY_LENGTH &&
    (roles.length > 0 ||
      (owner.current.key === runtime.sourceKey &&
        owner.current.scans.some((scan) => scan.query === query)));
  const key = runtime.sourceKey;
  const scope = useRef({ roles, after, before });
  useEffect(() => {
    scope.current = { roles, after, before };
  }, [roles, after, before]);
  const hasVisibleMatch = useCallback(
    (matches: SessionContentMatch[]) =>
      matches.some(
        (match) =>
          scope.current.roles.includes(match.role) &&
          inTimeRange(
            match.timestamp,
            scope.current.after,
            scope.current.before,
          ),
      ),
    [],
  );
  const wanted = useMemo(
    () =>
      new Map(
        active
          ? sessions.map((s) => [s.id, `${s.updatedAt}\0${s.messageCount}`])
          : [],
      ),
    [sessions, active],
  );
  const interested = useRef(document.visibilityState !== "hidden");
  useEffect(() => {
    const update = (visible: boolean) => {
      interested.current = visible;
      for (const scan of owner.current.scans) scan.setInterested(visible);
    };
    const visibility = () => update(document.visibilityState !== "hidden");
    const hide = () => update(false);
    visibility();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", visibility);
    };
  }, []);
  const [published, refresh] = useState(0);
  const publish = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const capacity = useRef(viewportRows);
  useEffect(() => {
    capacity.current = viewportRows;
  }, [viewportRows]);
  const changed = useRef(() => {
    if (publish.current) return;
    publish.current = setTimeout(() => {
      publish.current = undefined;
      const current = owner.current;
      const replacement = current.scans[1];
      if (
        replacement?.query === current.query &&
        ([...current.wanted].every(([id, version]) => {
          const entry = replacement.entries.get(id);
          return entry && scanDone(entry) && entry.revision === version;
        }) ||
          [...replacement.entries].filter(
            ([id, entry]) =>
              current.wanted.has(id) && hasVisibleMatch(entry.matches),
          ).length >= capacity.current)
      )
        current.scans.shift()!.stop();
      startTransition(() => refresh((value) => value + 1));
    }, 32);
  }).current;

  useEffect(() => {
    const current = owner.current;
    current.wanted = wanted;
    for (const scan of current.scans) scan.update(wanted);
  }, [wanted]);

  useEffect(() => {
    const current = owner.current;
    if (current.key !== key || !query.startsWith(current.query)) {
      for (const scan of current.scans) scan.stop();
      current.scans = [];
    }
    current.key = key;
    current.query = query;
    if (!active || current.scans.some((scan) => scan.query === query)) return;
    // One pending latest needle, never a FIFO of intermediate keystrokes.
    const timer = setTimeout(() => {
      if (current.scans.length === 2) {
        const second = current.scans[1]!;
        const ready =
          [...second.entries].filter(
            ([id, entry]) =>
              current.wanted.has(id) && hasVisibleMatch(entry.matches),
          ).length >= capacity.current ||
          [...current.wanted].every(([id, version]) => {
            const entry = second.entries.get(id);
            return entry && scanDone(entry) && entry.revision === version;
          });
        current.scans.splice(ready ? 0 : 1, 1)[0]!.stop();
      }
      const scan = new ContentSearchScan(
        query,
        { roles: ["assistant", "user"] },
        runtime.transport,
        changed,
        pool,
      );
      const previous = current.scans.at(-1);
      if (previous) scan.seedFrom(previous);
      current.scans.push(scan);
      scan.setInterested(interested.current);
      scan.update(current.wanted);
      changed();
    }, 120);
    return () => clearTimeout(timer);
  }, [key, query, runtime, changed, active, pool, hasVisibleMatch]);

  useEffect(
    () => () => {
      for (const scan of owner.current.scans) scan.stop();
      clearTimeout(publish.current);
    },
    [],
  );

  // Scan entries live on a ref and reach React through `changed`, so the
  // publication counter is what says a fresh projection is due. Every other
  // render — a keystroke elsewhere on the page, a filter, a row expanding —
  // reuses these maps, which the result list and every row compare by
  // identity.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `published` is the ref-held scans' publication trigger, not an input the body reads
  const projection = useMemo(() => {
    const scans = owner.current.scans;
    const exact = [...scans].reverse().find((scan) => scan.query === query);
    const matches = new Map<string, SessionContentMatch[]>();
    const partial = new Map<string, string>();
    const diagnostics = new Map<string, SessionContentDiagnostic[]>();
    const needle = query.replace(/\s+/g, " ").trim().toLowerCase();
    let scanned = 0;
    let limited = 0;
    let acquiring = !exact;
    const limitedSessions = new Set<string>();
    for (const [id, version] of wanted) {
      const complete = exact?.entries.get(id);
      if (!complete || !scanHasCompletePass(complete)) acquiring = true;
      if (complete && scanLimited(complete)) {
        limited++;
        limitedSessions.add(id);
      }
      if (
        complete &&
        scanDone(complete) &&
        (scanLimited(complete) || complete.revision === version)
      )
        scanned++;
      const found = new Map<string, SessionContentMatch>();
      for (const scan of scans) {
        if (!query.startsWith(scan.query)) continue;
        const entry = scan.entries.get(id);
        if (!entry) continue;
        const settled = scan === exact && scanDone(entry);
        if (settled) found.clear();
        for (const hit of entry.matches) {
          if (
            !roles.includes(hit.role) ||
            !inTimeRange(hit.timestamp, after, before)
          )
            continue;
          // Full-text refinement is sliced in the scan worker, never in urgent rendering.
          const match =
            scan === exact || hit.preview.toLowerCase().includes(needle)
              ? hit
              : undefined;
          if (match) found.set(match.id, match);
        }
        if (entry.partial !== undefined) partial.set(id, entry.partial);
        else if (settled) partial.delete(id);
        if (entry.diagnostics.length) diagnostics.set(id, entry.diagnostics);
        else if (settled) diagnostics.delete(id);
      }
      if (found.size) matches.set(id, [...found.values()]);
    }
    return {
      matches,
      partial,
      diagnostics,
      scanned,
      limited,
      limitedSessions,
      running: !exact || scanned < wanted.size,
      acquiring,
      error: undefined,
    };
  }, [published, wanted, query, roles, after, before]);

  if (!active || !roles.length || owner.current.key !== key)
    return {
      matches: EMPTY_MATCHES,
      partial: EMPTY_PARTIAL,
      diagnostics: EMPTY_DIAGNOSTICS,
      scanned: 0,
      limited: 0,
      limitedSessions: new Set<string>(),
      running: active && roles.length > 0,
      acquiring: active && roles.length > 0,
      error: undefined,
    };
  return projection;
}
