import { useCallback, useEffect, useState } from "react";
import { writeClipboardText } from "../lib/clipboard";
import styles from "./CockpitToolCopyButton.module.css";

export interface CockpitToolCopyButtonProps {
  copiedLabel: string;
  failedLabel: string;
  label: string;
  text: string;
}

type CopyStatus = "idle" | "copied" | "error";

function CopyIcon({ status }: { status: CopyStatus }) {
  if (status === "copied") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m5 12 4 4 10-10" />
      </svg>
    );
  }
  if (status === "error") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 8v5" />
        <path d="M12 17h.01" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

export function CockpitToolCopyButton({
  copiedLabel,
  failedLabel,
  label,
  text,
}: CockpitToolCopyButtonProps) {
  const [copying, setCopying] = useState(false);
  const [status, setStatus] = useState<CopyStatus>("idle");

  useEffect(() => {
    if (status === "idle") return;
    const timeout = globalThis.setTimeout(
      () => setStatus("idle"),
      status === "error" ? 12_000 : 4_500,
    );
    return () => globalThis.clearTimeout(timeout);
  }, [status]);

  const handleCopy = useCallback(async () => {
    if (copying) return;
    setCopying(true);
    setStatus("idle");
    const copied = await writeClipboardText(text);
    setCopying(false);
    setStatus(copied ? "copied" : "error");
  }, [copying, text]);

  const currentLabel = status === "copied"
    ? copiedLabel
    : status === "error"
    ? failedLabel
    : label;

  return (
    <button
      aria-label={currentLabel}
      className={styles.button}
      data-state={status}
      disabled={copying}
      onClick={() => void handleCopy()}
      title={currentLabel}
      type="button"
    >
      <CopyIcon status={status} />
      <span aria-live="polite">{currentLabel}</span>
    </button>
  );
}
