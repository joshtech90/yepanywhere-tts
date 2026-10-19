// Research-only replacement, selected by spike.vite.config.ts. Never shipped.
import { useContext, useEffect, useRef, useState } from "react";
import { useCurrentSourceRuntime } from "../../packages/client/src/contexts/SourceRuntimeContext";
import { ComposerInsertContext } from "../../packages/client/src/contexts/ComposerInsertContext";

export const SCRIPTLESS_PREVIEW_SANDBOX = "allow-same-origin";

export function ArtifactPreview(props: {
  html: string;
  path: string;
  documentPath?: string | null;
  projectId?: string;
  title: string;
  autoStart?: boolean;
}) {
  const runtime = useCurrentSourceRuntime();
  const insertIntoComposer = useContext(ComposerInsertContext);
  const insertRef = useRef(insertIntoComposer);
  insertRef.current = insertIntoComposer;
  const frame = useRef<HTMLIFrameElement>(null);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState(
    "Research viewer: HTML and local assets over the existing Yep connection",
  );
  const [suggestion, setSuggestion] = useState("");
  const [navigation, setNavigation] = useState<string | null>(null);
  const states = useRef(new Map<string, unknown>());
  const entry = props.documentPath ?? props.path;
  const selectedEntry = navigation ?? entry;

  useEffect(() => {
    if (!started) return;
    const element = frame.current;
    if (!element || !props.projectId || !entry.startsWith("/")) {
      setStatus("Spike requires an absolute file path and a project");
      return;
    }
    const root = entry.slice(0, entry.lastIndexOf("/") + 1);
    const channel = new MessageChannel();
    const abort = new AbortController();
    let closed = false;
    const reads = new Map<
      string,
      Promise<{ bytes: ArrayBuffer; mime: string }>
    >();
    let total = 0;
    let inFlight = 0;
    const read = (path: unknown) => {
      if (typeof path !== "string" || path.length > 4096)
        throw new Error("Invalid path");
      const canonical = decodeURIComponent(new URL(`file://${path}`).pathname);
      if (
        !canonical.startsWith(root) ||
        canonical
          .slice(root.length)
          .split("/")
          .some((p) => p.startsWith("."))
      )
        throw new Error("Outside this viewer's directory");
      const cached = reads.get(canonical);
      if (cached) return cached;
      if (reads.size >= 32 || inFlight >= 8)
        throw new Error("Spike file/concurrency limit");
      inFlight++;
      const pending = (async () => {
        // Existing server access checks still apply. Production needs an additional
        // server-enforced artifact-root grant, especially for symlinks.
        const path = `/projects/${encodeURIComponent(props.projectId!)}/files/raw?${new URLSearchParams({ path: canonical })}`;
        const response = await runtime.transport.fetchResponse(path, {
          signal: abort.signal,
        });
        const bytes = await response.arrayBuffer();
        total += bytes.byteLength;
        if (bytes.byteLength > 8 * 1024 * 1024 || total > 16 * 1024 * 1024)
          throw new Error("Spike byte limit");
        if (closed) throw new Error("Viewer closed");
        setStatus(
          `${reads.size} files · ${Math.ceil(total / 1024)} KiB · ${runtime.transport.kind}`,
        );
        return {
          bytes,
          mime:
            response.headers.get("content-type") ?? "application/octet-stream",
        };
      })().finally(() => inFlight--);
      reads.set(canonical, pending);
      return pending;
    };
    channel.port1.onmessage = async (event) => {
      const { id, type, path, text } = event.data ?? {};
      if (closed) return;
      try {
        if (type === "read") {
          const result = await read(path);
          if (!closed) channel.port1.postMessage({ id, ...result });
        } else if (
          type === "followup" &&
          typeof text === "string" &&
          text.length <= 8000
        ) {
          // No send action: a production adapter can insert this undoably into
          // the session composer, like the existing MCP Apps message bridge.
          setSuggestion(text);
          insertRef.current?.(text);
          channel.port1.postMessage({ id, ok: true });
        } else if (type === "navigate") {
          await read(path);
          channel.port1.postMessage({ id, ok: true });
          setNavigation(path);
        } else if (type === "state") {
          if (JSON.stringify(event.data.value).length > 16000)
            throw new Error("Widget state too large");
          states.current.set(selectedEntry, event.data.value);
          channel.port1.postMessage({ id, ok: true });
        } else if (type === "status") {
          setStatus(String(event.data.text).slice(0, 500));
        } else throw new Error("Unsupported bridge operation");
      } catch (error) {
        channel.port1.postMessage({ id, error: String(error) });
      }
    };
    const ready = (event: MessageEvent) => {
      if (
        event.source !== element.contentWindow ||
        event.origin !== "null" ||
        event.data?.type !== "ya-spike-ready"
      )
        return;
      window.removeEventListener("message", ready);
      element.contentWindow?.postMessage(
        {
          type: "ya-spike-init",
          entry: selectedEntry,
          widgetState: states.current.get(selectedEntry),
          title: props.title,
          theme: "light",
        },
        "*",
        [channel.port2],
      );
    };
    window.addEventListener("message", ready);
    element.src = `${window.location.origin}/artifact-sandbox.html?viewer=${crypto.randomUUID()}`;
    return () => {
      closed = true;
      abort.abort();
      window.removeEventListener("message", ready);
      channel.port1.close();
      channel.port2.close();
      reads.clear();
    };
  }, [started, entry, selectedEntry, props.projectId, props.title, runtime]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 300,
      }}
    >
      <div style={{ padding: 8, fontSize: 12 }}>
        <button type="button" onClick={() => setStarted((s) => !s)}>
          {started ? "Stop extension preview" : "Run extension preview"}
        </button>
        <span role="status" style={{ marginLeft: 8 }}>
          {status}
        </span>
      </div>
      {suggestion && (
        <p style={{ padding: 8 }}>
          Suggested follow-up (not sent): {suggestion}
        </p>
      )}
      {started ? (
        <iframe
          ref={frame}
          title={`${props.title} — extension sandbox`}
          sandbox="allow-scripts"
          style={{ border: 0, flex: 1, width: "100%", minHeight: 260 }}
        />
      ) : (
        <p style={{ padding: 16 }}>
          Isolated extension viewer spike. Press Run to read this HTML and its
          local assets.
        </p>
      )}
    </div>
  );
}
