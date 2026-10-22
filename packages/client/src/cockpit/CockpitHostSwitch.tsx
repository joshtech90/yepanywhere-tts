import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import styles from "./CockpitHostSwitch.module.css";
import {
  COCKPIT_PEER_PATH,
  parseCockpitPeer,
  type CockpitPeer,
} from "./core/peer";

// One answer per page load once the server has given one. A request that
// never reached the server (offline, proxy error) is retried on reconnect.
let peerRequest: Promise<CockpitPeer | null> | null = null;

function loadCockpitPeer(): Promise<CockpitPeer | null> {
  if (!peerRequest) {
    peerRequest =
      typeof fetch === "function"
        ? fetch(COCKPIT_PEER_PATH, { cache: "no-cache" })
            .then((response) => {
              if (response.status >= 500) {
                throw new Error("Peer discovery unavailable");
              }
              // A missing file answers with 404 or the app page (no JSON).
              return response.ok ? response.json().catch(() => null) : null;
            })
            .then((raw) => parseCockpitPeer(raw, window.location.origin))
            .catch(() => {
              peerRequest = null;
              return null;
            })
        : Promise.resolve(null);
  }
  return peerRequest;
}

/** Test seam: forget the cached answer so the next render asks again. */
export function forgetCockpitPeer(): void {
  peerRequest = null;
}

export function useCockpitPeer(): CockpitPeer | null {
  const [peer, setPeer] = useState<CockpitPeer | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => {
      void loadCockpitPeer().then((value) => {
        if (active) setPeer(value);
      });
    };
    const loadWhenVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    window.addEventListener("online", load);
    document.addEventListener("visibilitychange", loadWhenVisible);
    return () => {
      active = false;
      window.removeEventListener("online", load);
      document.removeEventListener("visibilitychange", loadWhenVisible);
    };
  }, []);
  return peer;
}

function SwitchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 8.5h13.5M15 5l3.5 3.5L15 12M19 15.5H5.5M9 12l-3.5 3.5L9 19" />
    </svg>
  );
}

interface CockpitHostSwitchProps {
  peer: CockpitPeer;
  /** "full" names the machine; "compact" is a square icon for phones. */
  variant: "full" | "compact";
}

/** Opens the Cockpit on the other machine in this window. */
export function CockpitHostSwitch({ peer, variant }: CockpitHostSwitchProps) {
  const { t } = useI18n();
  const [iconFailed, setIconFailed] = useState(false);
  const label = t("cockpitSwitchHost", { host: peer.label });
  return (
    <a
      aria-label={label}
      className={styles.hostSwitch}
      data-variant={variant}
      href={peer.url}
      title={label}
    >
      {iconFailed || !peer.icon ? (
        <span className={styles.fallbackIcon}>
          <SwitchIcon />
        </span>
      ) : (
        <img
          alt=""
          className={styles.peerIcon}
          draggable={false}
          onError={() => setIconFailed(true)}
          src={peer.icon}
        />
      )}
      {variant === "full" && (
        <span aria-hidden="true" className={styles.hostLabel}>
          {peer.label}
        </span>
      )}
      {/* On the bare icon the arrows sit as a badge on its corner. */}
      {(variant === "full" || peer.icon) && !iconFailed && (
        <span className={styles.switchMark}>
          <SwitchIcon />
        </span>
      )}
    </a>
  );
}
