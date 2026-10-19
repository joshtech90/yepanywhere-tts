import {
  PUBLIC_SHARE_SESSION_COMPRESSED_MAX_BYTES,
  type PublicShareLinkedFileMode,
} from "@yep-anywhere/shared";

/**
 * One viewer's compressed live-session snapshot, held only for the sequential
 * chunk pulls that follow the metadata request that built it.
 */
export interface PublicShareLiveTransfer {
  revisionId: string;
  integrityWitness: string;
  capturedAt: string;
  linkedFileMode: PublicShareLinkedFileMode;
  compressed: Uint8Array;
  sessionBytes: number;
  expiresAt: number;
}

/**
 * Bounded by entry age and total compressed bytes. A live snapshot is
 * rebuilt from the session on every viewer load, so eviction only makes an
 * in-progress transfer fail and restart; it never loses share content.
 */
export class PublicShareLiveTransfers {
  private readonly entries = new Map<string, PublicShareLiveTransfer>();
  private totalBytes = 0;

  constructor(
    private readonly maxTotalBytes = PUBLIC_SHARE_SESSION_COMPRESSED_MAX_BYTES,
    private readonly now: () => number = Date.now,
  ) {}

  set(key: string, transfer: PublicShareLiveTransfer): void {
    this.delete(key);
    this.sweep();
    while (
      this.entries.size > 0 &&
      this.totalBytes + transfer.compressed.byteLength > this.maxTotalBytes
    ) {
      const oldest = this.entries.keys().next().value as string;
      this.delete(oldest);
    }
    this.entries.set(key, transfer);
    this.totalBytes += transfer.compressed.byteLength;
  }

  get(key: string): PublicShareLiveTransfer | undefined {
    const transfer = this.entries.get(key);
    if (transfer && transfer.expiresAt <= this.now()) {
      this.delete(key);
      return undefined;
    }
    return transfer;
  }

  delete(key: string): void {
    const transfer = this.entries.get(key);
    if (!transfer) return;
    this.entries.delete(key);
    this.totalBytes -= transfer.compressed.byteLength;
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, transfer] of this.entries) {
      if (transfer.expiresAt <= now) this.delete(key);
    }
  }
}
