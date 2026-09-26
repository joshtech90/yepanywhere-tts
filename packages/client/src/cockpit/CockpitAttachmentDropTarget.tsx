import {
  type ClipboardEvent,
  type DragEvent,
  useEffect,
  useState,
} from "react";
import styles from "./CockpitAttachmentDropTarget.module.css";

function hasDraggedFiles(event: DragEvent<HTMLElement>) {
  return (
    event.dataTransfer.files.length > 0 ||
    Array.from(event.dataTransfer.types).includes("Files")
  );
}

function pastedFiles(event: ClipboardEvent<HTMLElement>) {
  return Array.from(event.clipboardData.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export function useCockpitAttachmentDropTarget(
  onFiles: (files: File[]) => void,
) {
  const [draggingFiles, setDraggingFiles] = useState(false);

  const resetDrag = () => setDraggingFiles(false);

  // A drag can end without a leave on this surface: dropped elsewhere,
  // cancelled with Escape, or out of the window. Any of these clears the cue.
  useEffect(() => {
    if (!draggingFiles) return;
    const clear = () => setDraggingFiles(false);
    const leaveWindow = (event: globalThis.DragEvent) => {
      if (event.relatedTarget === null) clear();
    };
    window.addEventListener("drop", clear);
    window.addEventListener("dragend", clear);
    document.addEventListener("dragleave", leaveWindow);
    return () => {
      window.removeEventListener("drop", clear);
      window.removeEventListener("dragend", clear);
      document.removeEventListener("dragleave", leaveWindow);
    };
  }, [draggingFiles]);

  return {
    draggingFiles,
    handlers: {
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        setDraggingFiles(true);
      },
      // Leaving counts only when the pointer leaves the whole surface. A
      // counter of enters and leaves stuck when a child under the pointer
      // disappeared mid-drag (a finished working line), and kept the cue up.
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!hasDraggedFiles(event)) return;
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setDraggingFiles(false);
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        // Browsers without relatedTarget on leave recover here.
        setDraggingFiles(true);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        const files = Array.from(event.dataTransfer.files);
        resetDrag();
        if (files.length === 0) return;
        event.preventDefault();
        onFiles(files);
      },
      onPaste: (event: ClipboardEvent<HTMLElement>) => {
        const files = pastedFiles(event);
        if (files.length === 0) return;
        event.preventDefault();
        onFiles(files);
      },
    },
  };
}

export function CockpitAttachmentDropCue({
  label,
  visible,
}: {
  label: string;
  visible: boolean;
}) {
  if (!visible) return null;
  return (
    <div className={styles.overlay} role="status">
      {label}
    </div>
  );
}
