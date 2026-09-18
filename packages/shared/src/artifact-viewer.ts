export interface ArtifactVhost {
  name: string;
  port: number;
  env?: string;
  public?: boolean;
}

export interface ArtifactViewerConfig {
  port: number;
  localOrigin?: string;
  publicOrigin?: string;
  /** Presence in status metadata enables the expiry setting on the client. */
  expiryHours?: number;
  /** Days a new link lives; presence enables the day-unit control. */
  expiryDays?: number;
  /** Whether a grant that states no ownership deletes its directory. */
  deleteOnExpiry?: boolean;
  /** Presence enables the static vhost table. */
  vhosts?: ArtifactVhost[];
  /** Optional apex such as graehl.org; empty means name.localhost only. */
  vhostPublicRoot?: string;
}

export interface ArtifactViewerStatus extends ArtifactViewerConfig {
  available: boolean;
  locked: boolean;
  defaultLocalOrigin: string;
}

export interface ArtifactViewerGrant {
  id: string;
  url: string;
  expiresAt: number;
  /** True when this grant deletes its directory at expiry or revocation. */
  owned?: boolean;
}
