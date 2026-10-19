import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  appTabRouteKey,
  isNavigateMessage,
  registerAppTab,
  rememberPopupBounds,
} from "./appTab";
import { getChrome } from "./chrome";
import { installSavedHostsMirror } from "./savedHosts";

/**
 * Mounted only in the extension's app tab: mirrors saved hosts for the
 * background worker, lets the side panel navigate this tab in place, and
 * publishes this tab's route so the panel can show what the page is about.
 */
export default function ExtensionAppBridge() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [ownTabId, setOwnTabId] = useState<number>();
  useEffect(() => installSavedHostsMirror(), []);
  useEffect(() => rememberPopupBounds(), []);
  useEffect(() => {
    const registration = registerAppTab();
    return () => void registration.then((unregister) => unregister());
  }, []);
  useEffect(() => {
    void getChrome()
      ?.tabs.getCurrent()
      .then((tab) => setOwnTabId(tab?.id));
  }, []);
  useEffect(() => {
    const chrome = getChrome();
    if (!chrome || ownTabId === undefined) return;
    const onMessage = (
      message: unknown,
      _sender: unknown,
      respond: (response: unknown) => void,
    ) => {
      if (!isNavigateMessage(message) || message.tabId !== ownTabId) return;
      navigate(message.path);
      respond(true);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [navigate, ownTabId]);
  // Withdrawn when the page goes away, so a tab that leaves the app for a
  // page the panel cannot read is not mistaken for its last session.
  useEffect(() => {
    const chrome = getChrome();
    if (!chrome || ownTabId === undefined) return;
    const key = appTabRouteKey(ownTabId);
    const publish = () =>
      void chrome.storage.session.set({ [key]: pathname }).catch(() => {});
    const withdraw = () =>
      void chrome.storage.session.remove(key).catch(() => {});
    publish();
    window.addEventListener("pageshow", publish);
    window.addEventListener("pagehide", withdraw);
    return () => {
      window.removeEventListener("pageshow", publish);
      window.removeEventListener("pagehide", withdraw);
    };
  }, [ownTabId, pathname]);
  return null;
}
