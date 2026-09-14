import { useMemo } from "react";
import { presentToolOutput } from "../lib/toolOutputPresentation";
import { AnsiText } from "./ui/AnsiText";
import styles from "./ToolOutputText.module.css";

export function ToolOutputText({
  text,
  compact = false,
}: {
  text: string;
  compact?: boolean;
}) {
  const parts = useMemo(() => presentToolOutput(text), [text]);
  return parts.map((part, index) => (
    <span
      key={index}
      data-tool-output-kind={part.kind}
      className={
        part.kind === "metadata"
          ? styles.metadata
          : part.kind === "json"
            ? styles.json
            : undefined
      }
    >
      <AnsiText as="span" text={compact ? part.source : part.text} />
    </span>
  ));
}
