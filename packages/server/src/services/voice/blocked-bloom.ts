import { open, rename, type FileHandle } from "node:fs/promises";

/**
 * One cache line, and the whole of a key's evidence. Every bit a key sets falls
 * inside its own block, so a lookup touches one line and a persisted change
 * touches one region — the property that makes this shape cheap both in memory
 * and on disk.
 */
const BLOCK_BYTES = 64;
/** Addresses one of the block's 512 bits exactly, so no field is wasted. */
const BLOCK_BIT_WIDTH = 9;
const DEFAULT_HASHES = 8;
/**
 * Bits per key at which the filter is called full. Eight bits per key at twelve
 * bits of room is a false-positive rate near half a percent before block
 * imbalance, which for this use costs a skipped message, never a wrong count.
 */
const BITS_PER_KEY = 12;
/** Dirty-tracking granularity: the unit written back to the file. */
const CHUNK_BYTES = 64 * 1024;

const HEADER_BYTES = 64;
const MAGIC = Buffer.from("YABLOOM1", "ascii");

/** Largest power of two at or below `bytes`, and never below one block. */
export function bloomBytes(bytes: number): number {
  const bounded = Math.max(BLOCK_BYTES, Math.floor(bytes));
  return 2 ** Math.floor(Math.log2(bounded));
}

/** Keys a filter of `bytes` holds before it is considered full. */
export function bloomCapacity(bytes: number): number {
  return Math.floor((bytes * 8) / BITS_PER_KEY);
}

/**
 * False-positive rate for `keys` in a filter of this shape. Blocking is what
 * makes this worth computing rather than quoting the textbook formula: keys are
 * spread over blocks by hash, so a block's load is Poisson around the mean and
 * the fuller blocks dominate the rate. Averaging the per-block rate over that
 * distribution is about 6% pessimistic against an unblocked filter of the same
 * size, and that difference is the point.
 */
export function bloomFalsePositiveRate(
  bytes: number,
  hashes: number,
  keys: number,
): number {
  const blocks = bloomBytes(bytes) / BLOCK_BYTES;
  const mean = keys / blocks;
  if (mean <= 0) return 0;
  let rate = 0;
  let weight = Math.exp(-mean);
  for (let load = 0; load < 100_000; load++) {
    if (load > mean && weight < 1e-15) break;
    const occupancy = 1 - (1 - 1 / (BLOCK_BYTES * 8)) ** (hashes * load);
    rate += weight * occupancy ** hashes;
    weight = (weight * mean) / (load + 1);
  }
  return rate;
}

/** Keys this shape holds before its false-positive rate passes `target`. */
export function bloomLoadForRate(
  bytes: number,
  hashes: number,
  target: number,
): number {
  let low = 0;
  let high = bloomCapacity(bytes) * 4;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (bloomFalsePositiveRate(bytes, hashes, middle) < target) low = middle;
    else high = middle;
  }
  return low;
}

function field(digest: Uint8Array, bit: number, width: number): number {
  const byte = bit >> 3;
  const value =
    (digest[byte]! | (digest[byte + 1]! << 8) | (digest[byte + 2]! << 16)) >>>
    (bit & 7);
  return value & ((1 << width) - 1);
}

/**
 * Blocked Bloom filter over 32-byte digests, resident in memory and backed by a
 * fixed-size file. Membership is approximate in one direction only: a key that
 * was added always reads as present, while a key that was not can read as
 * present at the configured rate. Adding never clears a bit, so a torn or
 * partial write can only lose evidence, never invent it.
 *
 * There is deliberately no locking. The only mutation is setting bits, so a
 * writer racing the file writer costs at worst one bit that reaches the file on
 * the next flush.
 */
export class BlockedBloom {
  readonly bytes: number;
  readonly hashes: number;
  private readonly blocks: number;
  private readonly bits: Buffer;
  private readonly dirty: Uint8Array;
  private readonly scratch: number[];
  private inserted = 0;
  private dirtyChunks = 0;

  constructor(bytes: number, hashes = DEFAULT_HASHES) {
    this.bytes = bloomBytes(bytes);
    this.hashes = hashes;
    if (48 + hashes * BLOCK_BIT_WIDTH > 8 * 24)
      throw new Error("Blocked Bloom filter needs more digest bits");
    this.blocks = this.bytes / BLOCK_BYTES;
    this.bits = Buffer.alloc(this.bytes);
    this.dirty = new Uint8Array(Math.ceil(this.bytes / CHUNK_BYTES));
    this.scratch = Array.from({ length: hashes }, () => 0);
  }

  get count(): number {
    return this.inserted;
  }

  get capacity(): number {
    return bloomCapacity(this.bytes);
  }

  /** Past its design load: further keys degrade the false-positive rate. */
  get saturated(): boolean {
    return this.inserted >= this.capacity;
  }

  get pendingWrites(): number {
    return this.dirtyChunks;
  }

  private block(digest: Uint8Array): number {
    return (
      (digest[0]! |
        (digest[1]! << 8) |
        (digest[2]! << 16) |
        ((digest[3]! & 0x7f) << 24)) %
      this.blocks
    );
  }

  private positions(digest: Uint8Array): number {
    for (let index = 0; index < this.hashes; index++)
      this.scratch[index] = field(
        digest,
        48 + index * BLOCK_BIT_WIDTH,
        BLOCK_BIT_WIDTH,
      );
    return this.block(digest) * BLOCK_BYTES;
  }

  has(digest: Uint8Array): boolean {
    const start = this.positions(digest);
    for (const bit of this.scratch)
      if (!(this.bits[start + (bit >> 3)]! & (1 << (bit & 7)))) return false;
    return true;
  }

  /** False when the key already read as present, so the caller can skip it. */
  add(digest: Uint8Array): boolean {
    const start = this.positions(digest);
    let novel = false;
    for (const bit of this.scratch) {
      const offset = start + (bit >> 3);
      const mask = 1 << (bit & 7);
      const byte = this.bits[offset]!;
      if (byte & mask) continue;
      this.bits[offset] = byte | mask;
      novel = true;
    }
    if (!novel) return false;
    this.inserted++;
    this.mark(start);
    return true;
  }

  private mark(offset: number): void {
    const chunk = Math.floor(offset / CHUNK_BYTES);
    if (this.dirty[chunk]) return;
    this.dirty[chunk] = 1;
    this.dirtyChunks++;
  }

  clear(): void {
    this.bits.fill(0);
    this.inserted = 0;
    this.dirty.fill(1);
    this.dirtyChunks = this.dirty.length;
  }

  /** Chunk indexes changed since the last call, which this call consumes. */
  takeDirty(): number[] {
    const chunks: number[] = [];
    for (let chunk = 0; chunk < this.dirty.length; chunk++) {
      if (!this.dirty[chunk]) continue;
      this.dirty[chunk] = 0;
      chunks.push(chunk);
    }
    this.dirtyChunks = 0;
    return chunks;
  }

  chunk(index: number): { bytes: Buffer; offset: number } {
    const offset = index * CHUNK_BYTES;
    return {
      bytes: this.bits.subarray(
        offset,
        Math.min(offset + CHUNK_BYTES, this.bytes),
      ),
      offset,
    };
  }

  /** Adopt file contents. The caller has already checked shape and magic. */
  adopt(bits: Buffer, count: number): void {
    bits.copy(this.bits);
    this.inserted = count;
    this.dirty.fill(0);
    this.dirtyChunks = 0;
  }
}

/**
 * The filter's file. Its size never changes while the filter's shape holds, so
 * a flush writes a header and the changed chunks in place: no truncate, no
 * temporary file, and no window where a reader sees an empty set. The
 * reservation is made by extending the file rather than writing it, so on a
 * filesystem with sparse files an untouched reservation costs a block or two.
 */
export class BloomFile {
  private handle: FileHandle | undefined;

  constructor(
    private readonly path: string,
    private filter: BlockedBloom,
  ) {}

  /**
   * Open the file and adopt it when its shape matches the filter. A missing,
   * foreign, or differently sized file is replaced by an empty reservation:
   * these counts are rebuilt by a rescan, so there is nothing to migrate.
   */
  async load(): Promise<boolean> {
    // Not "a+": append mode ignores the write position, which is the whole
    // point of this file.
    const handle = await open(this.path, "r+").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return open(this.path, "w+");
      },
    );
    this.handle = handle;
    const header = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(header, 0, HEADER_BYTES, 0);
    const matches =
      bytesRead === HEADER_BYTES &&
      header.subarray(0, MAGIC.length).equals(MAGIC) &&
      header.readUInt32LE(8) === this.filter.hashes &&
      header.readBigUInt64LE(16) === BigInt(this.filter.bytes);
    if (!matches) {
      await handle.truncate(HEADER_BYTES + this.filter.bytes);
      this.filter.clear();
      // A fresh reservation is already zeros on disk; writing them back would
      // spend the whole file's worth of I/O to say nothing.
      this.filter.takeDirty();
      await this.persist();
      return false;
    }
    const bits = Buffer.alloc(this.filter.bytes);
    await handle.read(bits, 0, bits.length, HEADER_BYTES);
    this.filter.adopt(bits, Number(header.readBigUInt64LE(24)));
    return true;
  }

  /** Write the header and every chunk changed since the last persist. */
  async persist(): Promise<void> {
    const handle = this.handle;
    if (!handle) return;
    const chunks = this.filter.takeDirty();
    for (const index of chunks) {
      const { bytes, offset } = this.filter.chunk(index);
      await handle.write(bytes, 0, bytes.length, HEADER_BYTES + offset);
    }
    const header = Buffer.alloc(HEADER_BYTES);
    MAGIC.copy(header);
    header.writeUInt32LE(this.filter.hashes, 8);
    header.writeBigUInt64LE(BigInt(this.filter.bytes), 16);
    header.writeBigUInt64LE(BigInt(this.filter.count), 24);
    await handle.write(header, 0, HEADER_BYTES, 0);
  }

  /**
   * Put `replacement` in this file's place. The rebuild that produced it ran
   * for minutes beside a filter that stayed in use, so the swap has to be the
   * one step that cannot half-happen: write the whole thing to a sibling, then
   * rename over. A crash leaves either the old complete filter or the new one,
   * and the caller adopts the same filter in memory.
   */
  async replace(replacement: BlockedBloom): Promise<void> {
    const staging = `${this.path}.rebuilding`;
    const handle = await open(staging, "w");
    try {
      const header = Buffer.alloc(HEADER_BYTES);
      MAGIC.copy(header);
      header.writeUInt32LE(replacement.hashes, 8);
      header.writeBigUInt64LE(BigInt(replacement.bytes), 16);
      header.writeBigUInt64LE(BigInt(replacement.count), 24);
      await handle.write(header, 0, HEADER_BYTES, 0);
      for (let index = 0; index * CHUNK_BYTES < replacement.bytes; index++) {
        const { bytes, offset } = replacement.chunk(index);
        await handle.write(bytes, 0, bytes.length, HEADER_BYTES + offset);
      }
      // The rename is only atomic against a crash if the bytes are on disk
      // before it happens.
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.close();
    await rename(staging, this.path);
    replacement.takeDirty();
    this.filter = replacement;
    await this.load();
  }

  async close(): Promise<void> {
    const handle = this.handle;
    this.handle = undefined;
    await handle?.close();
  }
}
