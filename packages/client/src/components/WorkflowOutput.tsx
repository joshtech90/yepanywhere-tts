import { Fragment, type ReactNode } from "react";
import { useI18n } from "../i18n";
import type {
  WorkflowAnnotation,
  WorkflowMarker,
} from "../lib/transcriptProjection/workflowTags";
import styles from "./WorkflowOutput.module.css";

function Boundary({ marker }: { marker: WorkflowMarker }) {
  const { t } = useI18n();
  return (
    <span
      className={styles.boundary}
      data-workflow-boundary={marker.kind}
      data-workflow-path={marker.path}
    >
      <mark className={styles.tag}>{marker.prefix}</mark>
      {marker.kind !== "activation" || marker.title ? (
        <span className={styles.title}>
          {marker.kind === "unresolved"
            ? t("workflowSchemaUnresolved")
            : marker.kind === "activation"
              ? t("workflowSchemaActivated", { title: marker.title })
              : marker.title}
        </span>
      ) : null}
    </span>
  );
}

export function WorkflowContext({
  workflow,
}: {
  workflow: WorkflowAnnotation;
}) {
  const { t } = useI18n();
  return (
    <>
      {workflow.parent ? (
        <div
          className={styles.context}
          data-workflow-parent={workflow.parent.path}
        >
          {workflow.parent.title}
        </div>
      ) : null}
      {workflow.markers
        .filter(
          (marker) =>
            !workflow.view &&
            (marker.kind === "activation" || marker.kind === "unresolved"),
        )
        .map((marker) => (
          <div
            key={marker.start}
            className={styles.context}
            title={marker.prefix}
            data-workflow-schema={marker.kind}
          >
            {marker.kind === "unresolved"
              ? t("workflowSchemaUnresolved")
              : t("workflowSchemaActivated", { title: marker.title })}
          </div>
        ))}
    </>
  );
}

export function WorkflowOutput({
  text,
  workflow,
  original,
}: {
  text: string;
  workflow: WorkflowAnnotation;
  original?: ReactNode;
}) {
  const { t } = useI18n();
  const content: ReactNode[] = [];
  let markerIndex = 0;
  for (const range of workflow.visibleRanges ?? [
    { start: 0, end: text.length },
  ]) {
    let offset = range.start;
    while (markerIndex < workflow.markers.length) {
      const marker = workflow.markers[markerIndex]!;
      if (marker.start >= range.end) break;
      markerIndex++;
      if (marker.start < range.start) continue;
      content.push(
        <Fragment key={marker.start}>
          {text.slice(offset, marker.start)}
          <Boundary marker={marker} />
        </Fragment>,
      );
      offset = marker.end;
    }
    content.push(text.slice(offset, range.end));
  }
  return (
    <div className={styles.root} data-workflow-output="true">
      <pre className={styles.content}>{content}</pre>
      <details className={styles.original}>
        <summary>{t("workflowOriginalOutput")}</summary>
        {original ?? <pre className={styles.content}>{text}</pre>}
      </details>
    </div>
  );
}
