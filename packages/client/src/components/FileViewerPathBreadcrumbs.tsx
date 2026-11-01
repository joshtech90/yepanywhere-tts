import {
  type FolderListingResponse,
  SERVER_CAPABILITIES,
  serverHasCapability,
} from "@yep-anywhere/shared";
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useVersion } from "../hooks/useVersion";
import { useI18n } from "../i18n";
import { toBrowserAppHref } from "../lib/appHref";
import { writeClipboardText } from "../lib/clipboard";
import { normalizePathSeparators } from "../lib/text";
import { buildProjectFileViewUrl } from "./FileDiffViewLinks";
import {
  FilePathContextMenu,
  useStartNewSessionFromFileAction,
} from "./FileResourceActions";
import { FolderListPopover, sortFolderEntries } from "./FolderListPopover";
import { PathBreadcrumbs } from "./PathBreadcrumbs";

interface FileViewerPathBreadcrumbsProps {
  projectId: string;
  /** The header's display path: project-relative, `~/…`, or absolute. */
  displayPath: string;
  /** The open file as the listing route takes it: relative, else absolute. */
  requestPath: string;
  /** The project's own path, for absolute folder copies; null when unknown. */
  projectPath: string | null;
  /** Lists a folder through the viewer's source; absent on public shares. */
  listFolder?: (
    projectId: string,
    folderPath: string,
  ) => Promise<FolderListingResponse>;
  onOpenFile: (path: string) => void;
  /**
   * A folder, in `requestPath`'s form, to list on arrival: the target of a
   * folder opened in a new tab. Anchored at its segment, else at the name.
   */
  initialFolder?: string;
}

/**
 * Each display segment's folder in the request path's own form. The display
 * path differs from the request path only by a shortened prefix (`~` for a
 * home directory), so segments align from the end. Null when they do not.
 */
function folderPathsBySegment(
  displayPath: string,
  requestPath: string,
): (string | null)[] | null {
  const display = displayPath.split("/");
  const request = normalizePathSeparators(requestPath).split("/");
  if (
    request.length < display.length ||
    request[request.length - 1] !== display[display.length - 1]
  ) {
    return null;
  }
  return display.slice(0, -1).map((segment, index) => {
    if (segment === "") return null;
    const folder = request
      .slice(0, request.length - (display.length - 1 - index))
      .join("/");
    return folder === "" ? null : folder;
  });
}

type OpenFolder = { segment: number; folder: string; anchor: HTMLElement };
type FolderMenu = OpenFolder & { x: number; y: number };

/**
 * The File Viewer's path as clickable folder segments: a click lists that
 * folder, a right-click offers folder actions, and the file name lists its own
 * folder. Renders the plain path when the source cannot list folders or the
 * server lacks `file-folder-listing`, so a public share never shows them.
 */
export function FileViewerPathBreadcrumbs(
  props: FileViewerPathBreadcrumbsProps,
) {
  // Decided before any hook runs: a public share's source cannot list, and its
  // reader has no authenticated route to ask the server's version from.
  if (!props.listFolder) return <PathBreadcrumbs path={props.displayPath} />;
  return <ListablePathBreadcrumbs {...props} listFolder={props.listFolder} />;
}

function ListablePathBreadcrumbs({
  projectId,
  displayPath,
  requestPath,
  projectPath,
  listFolder,
  onOpenFile,
  initialFolder,
}: FileViewerPathBreadcrumbsProps & {
  listFolder: NonNullable<FileViewerPathBreadcrumbsProps["listFolder"]>;
}) {
  const { t } = useI18n();
  const { version } = useVersion();
  const basePath = useRemoteBasePath();
  const startNewSession = useStartNewSessionFromFileAction();
  const [open, setOpen] = useState<OpenFolder | null>(null);
  const [menu, setMenu] = useState<FolderMenu | null>(null);
  const closeOpen = useCallback(() => setOpen(null), []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const pathRef = useRef<HTMLSpanElement>(null);
  const pendingInitialFolder = useRef(initialFolder);
  const folders = folderPathsBySegment(displayPath, requestPath);
  const canList =
    folders !== null &&
    serverHasCapability(version, SERVER_CAPABILITIES.fileFolderListing.name);
  const load = useCallback(
    (folder: string) => listFolder(projectId, folder),
    [listFolder, projectId],
  );
  // A file at the project root lists the root; one directly under "/" lists
  // nothing, since no segment names that folder.
  const fileFolder = !folders
    ? null
    : folders.length === 0
      ? ""
      : (folders.at(-1) ?? null);
  const lastSegment = (folders?.length ?? 0) - 1;

  useLayoutEffect(() => {
    const folder = pendingInitialFolder.current;
    if (folder === undefined || !canList || !folders) return;
    pendingInitialFolder.current = undefined;
    const index = folders.indexOf(folder);
    const segment = index >= 0 ? index : lastSegment;
    const anchor =
      pathRef.current?.querySelector<HTMLElement>(
        `[data-segment="${index >= 0 ? index : lastSegment + 1}"]`,
      ) ?? pathRef.current;
    if (anchor) setOpen({ segment, folder, anchor });
  });

  if (!folders || !canList) {
    return <PathBreadcrumbs path={displayPath} />;
  }

  /** This file's viewer URL, optionally arriving with `folder` listed. */
  const viewerHref = (filePath: string, folder?: string) =>
    toBrowserAppHref(
      buildProjectFileViewUrl({ basePath, filePath, folder, projectId }),
    );
  const folderHref = (folder: string) => viewerHref(requestPath, folder);
  const isRelative = !/^([a-zA-Z]:)?[/\\~]/.test(requestPath);
  const absoluteFolder = (folder: string) =>
    isRelative
      ? projectPath
        ? `${projectPath.replace(/\/+$/, "")}/${folder}`
        : null
      : folder.startsWith("~")
        ? null
        : folder;
  const segmentLabel = (segment: number) =>
    `${displayPath
      .split("/")
      .slice(0, segment + 1)
      .join("/")}/`;

  const copyListing = async (folder: string) => {
    const listing = await load(folder);
    await writeClipboardText(
      sortFolderEntries(listing.entries)
        .map((entry) =>
          entry.kind === "folder" ? `${entry.name}/` : entry.name,
        )
        .join("\n"),
    );
  };

  return (
    <>
      {/* Adds no box; it scopes the arrival lookup of a segment's element. */}
      <span ref={pathRef} style={{ display: "contents" }}>
        <PathBreadcrumbs
          path={displayPath}
          activeSegment={open?.segment ?? menu?.segment ?? null}
          folderHref={(segment) => {
            const folder = folders[segment];
            return folder === undefined || folder === null
              ? undefined
              : folderHref(folder);
          }}
          nameHref={fileFolder === null ? undefined : folderHref(fileFolder)}
          onFolderActivate={(segment, anchor) => {
            const folder = folders[segment];
            if (folder === undefined || folder === null) return;
            setMenu(null);
            setOpen((current) =>
              current?.segment === segment ? null : { segment, folder, anchor },
            );
          }}
          onFolderContextMenu={(segment, event: ReactMouseEvent) => {
            const folder = folders[segment];
            if (folder === undefined || folder === null) return;
            setOpen(null);
            setMenu({
              segment,
              folder,
              anchor: event.currentTarget as HTMLElement,
              x: event.clientX,
              y: event.clientY,
            });
          }}
          onNameActivate={
            fileFolder === null
              ? undefined
              : (anchor) => {
                  setMenu(null);
                  setOpen((current) =>
                    current?.segment === lastSegment
                      ? null
                      : { segment: lastSegment, folder: fileFolder, anchor },
                  );
                }
          }
        />
      </span>
      {open ? (
        <FolderListPopover
          key={`${open.segment}\0${open.folder}`}
          folder={open.folder}
          rootLabel={
            projectPath?.replace(/\/+$/, "").split("/").at(-1) ||
            t("folderListProjectRoot" as never)
          }
          currentPath={normalizePathSeparators(requestPath)}
          anchor={open.anchor}
          load={load}
          fileHref={(path) => viewerHref(path)}
          folderHref={folderHref}
          onOpenFile={(path) => {
            setOpen(null);
            onOpenFile(path);
          }}
          onClose={closeOpen}
        />
      ) : null}
      {menu ? (
        <FilePathContextMenu
          x={menu.x}
          y={menu.y}
          folder
          heading={segmentLabel(menu.segment)}
          onClose={closeMenu}
          newTabHref={folderHref(menu.folder)}
          onOpen={() =>
            setOpen({
              segment: menu.segment,
              folder: menu.folder,
              anchor: menu.anchor,
            })
          }
          onStartNewSession={() =>
            startNewSession(projectId, `${menu.folder}/`)
          }
          onCopyProjectRelativePath={
            isRelative
              ? () => void writeClipboardText(`${menu.folder}/`)
              : undefined
          }
          onCopyAbsolutePath={(() => {
            const absolute = absoluteFolder(menu.folder);
            return absolute
              ? () => void writeClipboardText(`${absolute}/`)
              : undefined;
          })()}
          onCopyListing={() => void copyListing(menu.folder)}
        />
      ) : null}
    </>
  );
}
