import { useEffect } from "react";
import {
  parseLocalResourceAttributes,
  type LocalResourceRef,
} from "@yep-anywhere/shared";

export function useScriptlessPreviewLinks(
  frame: HTMLIFrameElement | null,
  running: boolean,
  onLocalResourceLink?: (
    resource: LocalResourceRef,
    anchor: HTMLAnchorElement,
  ) => void,
) {
  useEffect(() => {
    if (!frame || running || !onLocalResourceLink) return;
    // The same-origin preview lets the viewer listen inside it; the frame's
    // elements belong to its own realm, so no `instanceof` checks.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const anchor = (event.target as Element | null)?.closest?.(
        "a[data-ya-resource], area[data-ya-resource]",
      ) as HTMLAnchorElement | null | undefined;
      if (!anchor) return;
      const resource = parseLocalResourceAttributes({
        "data-ya-resource": anchor.getAttribute("data-ya-resource"),
        "data-ya-path": anchor.getAttribute("data-ya-path"),
      });
      if (!resource) return;
      event.preventDefault();
      onLocalResourceLink(resource, anchor);
    };
    let listening: Document | null = null;
    const listen = () => {
      listening?.removeEventListener("click", onClick);
      listening = frame.contentDocument;
      listening?.addEventListener("click", onClick);
    };
    listen();
    frame.addEventListener("load", listen);
    return () => {
      frame.removeEventListener("load", listen);
      listening?.removeEventListener("click", onClick);
    };
  }, [frame, running, onLocalResourceLink]);
}
