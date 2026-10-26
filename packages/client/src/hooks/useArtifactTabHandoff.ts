import { isArtifactTabRequest } from "@yep-anywhere/shared";
import { useEffect } from "react";
import { artifactTabUrl } from "../lib/artifactPreview";

/**
 * Opens a new tab when the running artifact frame asks for one of its own
 * grant's files, such as a PDF the sandboxed frame cannot display. The frame
 * itself may not open popups, since an unsandboxed popup could navigate the YA
 * tab; this tab has no opener. The browser still requires the click inside the
 * frame that sent the request, so a frame cannot open tabs unprompted.
 * `resolve` decides which requested URLs the frame's grant covers; a project
 * app frame passes `appTabUrl`.
 */
export function useArtifactTabHandoff(
  frame: HTMLIFrameElement | null,
  grantUrl: string | undefined,
  resolve: (
    requested: string,
    grantUrl: string,
  ) => string | undefined = artifactTabUrl,
): void {
  useEffect(() => {
    if (!frame || !grantUrl) return;
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== frame.contentWindow ||
        !isArtifactTabRequest(event.data)
      )
        return;
      const url = resolve(event.data.url, grantUrl);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame, grantUrl, resolve]);
}
