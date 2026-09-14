import { useCallback, useEffect, useState } from "react";
import { useCurrentSourceRuntime } from "../../contexts/SourceRuntimeContext";
import { useInlineMedia } from "../../hooks/useInlineMedia";
import { useI18n } from "../../i18n";
import type { ExplorationParent } from "../../lib/sessionDetail/explorationProjection";
import { getPathBasename } from "../../lib/text";
import { useImageResourceActions } from "../ImageResourceActions";
import { fetchLocalMediaBlob, LocalMediaModal } from "../LocalMediaModal";
import styles from "./ExploredImageStrip.module.css";

export interface ExploredImage {
  id: string;
  name: string;
  path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function imagePathForTool(input: unknown, structured: unknown): string | null {
  for (const key of ["file_path", "path", "filePath"]) {
    const value = isRecord(input) ? input[key] : undefined;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const file = isRecord(structured) ? structured.file : undefined;
  const resultPath = isRecord(file) ? file.filePath : undefined;
  return typeof resultPath === "string" && resultPath.trim()
    ? resultPath.trim()
    : null;
}

/**
 * A grouped exploration hides each image read behind a one-line filename. The
 * strip shows what the model actually looked at, reading each file back through
 * the session's media route rather than depending on provider bytes that the
 * transcript no longer carries.
 */
export function collectExploredImages(
  parents: readonly ExplorationParent[],
): ExploredImage[] {
  const images: ExploredImage[] = [];
  const seen = new Set<string>();
  for (const parent of parents) {
    const structured = parent.item.toolResult?.structured;
    const isImageResult = isRecord(structured) && structured.type === "image";
    if (!isImageResult) continue;
    const path = imagePathForTool(parent.item.toolInput, structured);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    images.push({ id: parent.item.id, name: getPathBasename(path), path });
  }
  return images;
}

function ExploredImageThumbnail({
  image,
  onOpen,
}: {
  image: ExploredImage;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const transport = useCurrentSourceRuntime().transport;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const loadBlob = useCallback(
    () => fetchLocalMediaBlob(image.path, undefined, "inline", transport),
    [image.path, transport],
  );
  const imageActions = useImageResourceActions({
    fileName: image.name,
    filePath: image.path,
    loadBlob,
    onOpen,
  });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setFailed(false);
    void loadBlob()
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [loadBlob]);

  return (
    <div className={styles.item}>
      <button
        type="button"
        className={styles.thumbnail}
        aria-label={image.name}
        title={image.name}
        onClick={onOpen}
        onContextMenu={imageActions.handleContextMenu}
      >
        {url ? (
          <img src={url} alt={image.name} draggable={false} />
        ) : (
          <span className={styles.placeholder}>
            {failed ? t("inlineImageUnavailable") : t("inlineImageLoading")}
          </span>
        )}
      </button>
      <span className={styles.caption}>{image.name}</span>
      {imageActions.contextMenuElement}
    </div>
  );
}

export function ExploredImageStrip({
  images,
}: {
  images: readonly ExploredImage[];
}) {
  const { t } = useI18n();
  const { inlineMediaExpandedByDefault } = useInlineMedia();
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = override ?? inlineMediaExpandedByDefault;
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const open = openIndex === null ? null : images[openIndex];
  const label = t(
    images.length === 1 ? "exploredImagesOne" : "exploredImagesMany",
    { count: images.length },
  );

  return (
    <div className={styles.strip} data-explored-images={images.length}>
      <div className="local-media-link-group">
        <button
          type="button"
          className="local-media-inline-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? t("explorationCollapse") : label}
          onClick={() => setOverride(!expanded)}
        >
          {expanded ? "-" : "+"}
        </button>
        <span className="local-media-type">{label}</span>
      </div>
      {expanded && (
        <div className={styles.row}>
          {images.map((image, index) => (
            <ExploredImageThumbnail
              key={`${image.id}:${image.path}`}
              image={image}
              onOpen={() => setOpenIndex(index)}
            />
          ))}
        </div>
      )}
      {open ? (
        <LocalMediaModal
          path={open.path}
          mediaType="image"
          imageNavigation={
            images.length > 1 && openIndex !== null
              ? {
                  count: images.length,
                  current: openIndex + 1,
                  onNext: () =>
                    setOpenIndex((index) =>
                      index === null ? null : (index + 1) % images.length,
                    ),
                  onPrevious: () =>
                    setOpenIndex((index) =>
                      index === null
                        ? null
                        : (index - 1 + images.length) % images.length,
                    ),
                }
              : undefined
          }
          onClose={() => setOpenIndex(null)}
        />
      ) : null}
    </div>
  );
}
