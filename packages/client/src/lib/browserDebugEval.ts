interface BrowserDebugScriptBridge {
  started: boolean;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const BRIDGE_PREFIX = "__YA_BROWSER_DEBUG_EVAL__";
export const BROWSER_DEBUG_EVAL_LOCAL_TIMEOUT_MS = 50_000;
let bridgeSequence = 0;

function scriptSource(
  bridgeKey: string,
  code: string,
  mode: "expression" | "statements",
): string {
  const bridge = `globalThis[${JSON.stringify(bridgeKey)}]`;
  const evaluation =
    mode === "expression"
      ? `await (\n${code}\n)`
      : `await (async () => {\n${code}\n})()`;
  return `void (async () => {
  const bridge = ${bridge};
  if (!bridge) return;
  bridge.started = true;
  try {
    bridge.resolve(${evaluation});
  } catch (error) {
    bridge.reject(error);
  }
})();`;
}

/**
 * Execute an explicitly granted browser-debug command without `eval` or
 * `Function`. Both the built HTML and server CSP permit Blob scripts while
 * denying runtime compilation and unapproved inline scripts in production.
 */
export function executeBrowserDebugCode(
  code: string,
  timeoutMs = BROWSER_DEBUG_EVAL_LOCAL_TIMEOUT_MS,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bridgeKey = `${BRIDGE_PREFIX}${Date.now()}_${bridgeSequence++}`;
    const debugGlobal = globalThis as unknown as Record<string, unknown>;
    let scriptError: unknown = null;
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    let script: HTMLScriptElement | null = null;

    const releaseScript = () => {
      if (!script) return;
      script.onload = null;
      script.onerror = null;
      script.remove();
      URL.revokeObjectURL(script.src);
      script = null;
    };

    const cleanup = () => {
      if (deadline) clearTimeout(deadline);
      deadline = null;
      releaseScript();
      window.removeEventListener("error", onScriptError);
      delete debugGlobal[bridgeKey];
    };
    const settle = (outcome: "resolve" | "reject", value: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (outcome === "resolve") resolve(value);
      else reject(value);
    };
    const bridge: BrowserDebugScriptBridge = {
      started: false,
      resolve: (value) => settle("resolve", value),
      reject: (error) => settle("reject", error),
    };
    const onScriptError = (event: ErrorEvent) => {
      if (bridge.started || event.filename !== script?.src) return;
      scriptError = event.error ?? new SyntaxError(event.message);
    };
    const run = (mode: "expression" | "statements") => {
      if (settled) return;
      releaseScript();
      bridge.started = false;
      scriptError = null;
      script = document.createElement("script");
      script.dataset.yaBrowserDebugEval = mode;
      script.src = URL.createObjectURL(
        new Blob([scriptSource(bridgeKey, code, mode)], {
          type: "text/javascript",
        }),
      );
      script.onerror = () =>
        settle(
          "reject",
          new Error(
            "Browser diagnostic script was blocked or could not load. The page's Content Security Policy must allow blob: scripts; update the client and server, then reload this tab.",
          ),
        );
      script.onload = () => {
        releaseScript();
        if (bridge.started) return;
        if (mode === "expression") run("statements");
        else
          settle(
            "reject",
            scriptError ??
              new SyntaxError(
                "Browser diagnostic JavaScript could not be parsed",
              ),
          );
      };
      document.documentElement.append(script);
    };

    debugGlobal[bridgeKey] = bridge;
    window.addEventListener("error", onScriptError);
    deadline = setTimeout(
      () =>
        settle(
          "reject",
          new Error(
            `Browser diagnostic evaluation exceeded its ${timeoutMs} ms local deadline`,
          ),
        ),
      timeoutMs,
    );

    run("expression");
  });
}
