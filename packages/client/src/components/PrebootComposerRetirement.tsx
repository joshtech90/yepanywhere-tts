import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  isNewSessionPathname,
  retirePrebootComposer,
} from "../lib/prebootComposer";

/**
 * Clears the pre-boot new-session composer as soon as routing settles on a
 * different page (a login redirect), so it never covers that page. The
 * new-session form adopts it instead when the route stays put.
 */
export function PrebootComposerRetirement() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    if (!isNewSessionPathname(pathname)) retirePrebootComposer();
  }, [pathname]);
  return null;
}
