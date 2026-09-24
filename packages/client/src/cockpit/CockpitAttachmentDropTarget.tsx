import { type ClipboardEvent, type DragEvent, useRef, useState } from "react";
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
  const dragDepthRef = useRef(0);
  const [draggingFiles, setDraggingFiles] = useState(false);

  const resetDrag = () => {
    dragDepthRef.current = 0;
    setDraggingFiles(false);
  };

  return {
    draggingFiles,
    handlers: {
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setDraggingFiles(true);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!hasDraggedFiles(event)) return;
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDraggingFiles(false);
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!hasDraggedFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
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
