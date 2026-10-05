import type { UploadedFile } from "@yep-anywhere/shared";
import {
  THUMBNAIL_HEIGHT_PX,
  THUMBNAIL_MIME_TYPE,
  THUMBNAIL_MAX_ASPECT_RATIO,
  planThumbnail,
} from "@yep-anywhere/shared";
import { getEntry, openDatabase, putEntryWithKey } from "./diagnostics/idb";

const DB_NAME = "yep-anywhere-attachment-previews";
const DB_VERSION = 3;
const STORE_NAME = "images";
/**
 * Blobs live apart from the records that describe them: Chromium writes a new
 * file for every Blob in a put, so a record touched on each access must not
 * carry one.
 */
const BLOB_STORE_NAME = "blobs";
const MAX_CACHE_BYTES = 128 * 1024 * 1024;
const THUMBNAIL_CACHE_VARIANT = `thumb:v3:${THUMBNAIL_HEIGHT_PX}:${THUMBNAIL_MAX_ASPECT_RATIO}:${THUMBNAIL_MIME_TYPE}`;

interface CachedAttachmentMetadata {
  attachmentId: string;
  path: string;
  originalName: string;
  mimeType: string;
  size: number;
  thumbnailVariant: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
  totalBytes: number;
  createdAt: number;
  lastAccessedAt: number;
}

interface CachedAttachmentBlobs {
  thumbnailBlob?: Blob;
  fullBlob: Blob;
}

type CachedAttachmentPreview = CachedAttachmentMetadata & CachedAttachmentBlobs;

/**
 * Stored under an attachment's persisted path so a chip that knows only that
 * path reaches the preview kept under its attachment id. Carries no blobs, and
 * counts as zero bytes against the cache budget.
 */
interface CachedAttachmentAlias {
  aliasFor: string;
  totalBytes: 0;
  lastAccessedAt: number;
}

type CachedAttachmentRecord = CachedAttachmentMetadata | CachedAttachmentAlias;

function isAlias(
  record: CachedAttachmentRecord | null,
): record is CachedAttachmentAlias {
  return record !== null && "aliasFor" in record;
}

function aliasTo(attachmentId: string): CachedAttachmentAlias {
  return { aliasFor: attachmentId, totalBytes: 0, lastAccessedAt: Date.now() };
}

let dbPromise: Promise<IDBDatabase> | null = null;
/** Uploads whose bytes are in hand but not yet stored. Never grows past those. */
const memoryPreviews = new Map<string, CachedAttachmentPreview>();

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function splitPreview(preview: CachedAttachmentPreview): {
  metadata: CachedAttachmentMetadata;
  blobs: CachedAttachmentBlobs;
} {
  const { fullBlob, thumbnailBlob, ...metadata } = preview;
  return { metadata, blobs: { fullBlob, thumbnailBlob } };
}

/** Moves blobs that version 2 kept inline into their own store, once. */
function migrateInlineBlobs(tx: IDBTransaction): void {
  const records = tx.objectStore(STORE_NAME);
  const blobs = tx.objectStore(BLOB_STORE_NAME);
  const request = records.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const value = cursor.value as
      | CachedAttachmentAlias
      | Partial<CachedAttachmentPreview>;
    if ("fullBlob" in value && value.fullBlob) {
      const split = splitPreview(value as CachedAttachmentPreview);
      blobs.put(split.blobs, cursor.primaryKey);
      cursor.update(split.metadata);
    }
    cursor.continue();
  };
}

function getDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabase(DB_NAME, DB_VERSION, (db, tx) => {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME);
        store.createIndex("byLastAccessedAt", "lastAccessedAt");
      } else {
        const store = tx.objectStore(STORE_NAME);
        if (!store.indexNames.contains("byLastAccessedAt")) {
          store.createIndex("byLastAccessedAt", "lastAccessedAt");
        }
      }
      if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) {
        db.createObjectStore(BLOB_STORE_NAME);
        migrateInlineBlobs(tx);
      }
    });
  }
  return dbPromise;
}

function completion(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

/** Stores a preview's record and blobs together under one key. */
async function writePreview(
  db: IDBDatabase,
  key: string,
  preview: CachedAttachmentPreview,
): Promise<void> {
  const { metadata, blobs } = splitPreview(preview);
  const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], "readwrite");
  tx.objectStore(STORE_NAME).put(metadata, key);
  tx.objectStore(BLOB_STORE_NAME).put(blobs, key);
  await completion(tx);
}

/** Deletes whatever a key holds in both stores. */
async function deleteStored(db: IDBDatabase, key: string): Promise<void> {
  const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], "readwrite");
  tx.objectStore(STORE_NAME).delete(key);
  tx.objectStore(BLOB_STORE_NAME).delete(key);
  await completion(tx);
}

async function createThumbnailBlob(
  file: Blob,
): Promise<{ blob: Blob; width: number; height: number } | undefined> {
  if (typeof createImageBitmap !== "function") {
    return undefined;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const thumb = planThumbnail(bitmap.width, bitmap.height);

    const canvas = document.createElement("canvas");
    canvas.width = thumb.width;
    canvas.height = thumb.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return undefined;
    }
    ctx.drawImage(
      bitmap,
      thumb.sourceX,
      thumb.sourceY,
      thumb.sourceWidth,
      thumb.sourceHeight,
      0,
      0,
      thumb.width,
      thumb.height,
    );
    bitmap.close();

    const blob = await new Promise<Blob | undefined>((resolve) => {
      canvas.toBlob(
        (value) => resolve(value ?? undefined),
        THUMBNAIL_MIME_TYPE,
      );
    });
    if (!blob) {
      return undefined;
    }

    return { blob, width: thumb.width, height: thumb.height };
  } catch {
    return undefined;
  }
}

function needsThumbnailRefresh(entry: CachedAttachmentPreview): boolean {
  return entry.thumbnailVariant !== THUMBNAIL_CACHE_VARIANT;
}

async function calculateCacheSize(db: IDBDatabase): Promise<number> {
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const request = store.getAll();
  const entries =
    (await new Promise<CachedAttachmentRecord[]>((resolve, reject) => {
      request.onsuccess = () =>
        resolve(request.result as CachedAttachmentRecord[]);
      request.onerror = () => reject(request.error);
    })) ?? [];
  return entries.reduce((sum, entry) => sum + (entry.totalBytes ?? 0), 0);
}

async function evictOldestEntries(
  db: IDBDatabase,
  bytesToFree: number,
): Promise<void> {
  if (bytesToFree <= 0) return;

  const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const blobStore = tx.objectStore(BLOB_STORE_NAME);
  const index = store.index("byLastAccessedAt");
  let freed = 0;

  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || freed >= bytesToFree) {
        resolve();
        return;
      }

      const value = cursor.value as CachedAttachmentRecord;
      if (isAlias(value)) {
        cursor.continue();
        return;
      }

      freed += value.totalBytes ?? 0;
      blobStore.delete(cursor.primaryKey);
      cursor.delete();
      if (value.path && value.path !== value.attachmentId) {
        const aliasRequest = store.get(value.path);
        aliasRequest.onerror = () => reject(aliasRequest.error);
        aliasRequest.onsuccess = () => {
          const alias = aliasRequest.result as
            | CachedAttachmentRecord
            | undefined;
          if (
            alias &&
            isAlias(alias) &&
            alias.aliasFor === value.attachmentId
          ) {
            store.delete(value.path);
          }
          cursor.continue();
        };
        return;
      }
      cursor.continue();
    };
  });

  await completion(tx);
}

/**
 * The preview stored at a key, following one pointer, with the key it is
 * actually stored under so later writes land there.
 */
async function readPreview(
  db: IDBDatabase,
  key: string,
): Promise<{
  key: string;
  preview: CachedAttachmentPreview;
  viaAlias: boolean;
} | null> {
  const record = await getEntry<CachedAttachmentRecord>(db, STORE_NAME, key);
  if (!record) return null;
  let storageKey = key;
  let metadata: CachedAttachmentMetadata;
  if (isAlias(record)) {
    const target = await getEntry<CachedAttachmentRecord>(
      db,
      STORE_NAME,
      record.aliasFor,
    );
    if (!target || isAlias(target)) return null;
    storageKey = record.aliasFor;
    metadata = target;
  } else {
    metadata = record;
  }
  const blobs = await getEntry<CachedAttachmentBlobs>(
    db,
    BLOB_STORE_NAME,
    storageKey,
  );
  if (!blobs) return null;
  return {
    key: storageKey,
    preview: { ...metadata, ...blobs },
    viaAlias: storageKey !== key,
  };
}

/** The attachment id a stored path points at, when it is a pointer. */
async function readAlias(db: IDBDatabase, key: string): Promise<string | null> {
  const record = await getEntry<CachedAttachmentRecord>(db, STORE_NAME, key);
  return isAlias(record) ? record.aliasFor : null;
}

function rememberMemoryPreview(entry: CachedAttachmentPreview): void {
  memoryPreviews.set(entry.attachmentId, entry);
  if (entry.path && entry.path !== entry.attachmentId) {
    memoryPreviews.set(entry.path, entry);
  }
}

function forgetMemoryPreview(entry: CachedAttachmentPreview): void {
  memoryPreviews.delete(entry.attachmentId);
  if (entry.path) memoryPreviews.delete(entry.path);
}

export async function storeUploadedAttachmentPreview(
  uploadedFile: UploadedFile,
  sourceFile: File,
): Promise<void> {
  if (!isImageMimeType(uploadedFile.mimeType)) {
    return;
  }

  const uploadDimensions =
    uploadedFile.width !== undefined && uploadedFile.height !== undefined
      ? planThumbnail(uploadedFile.width, uploadedFile.height)
      : undefined;
  const fullBlob = sourceFile.slice(0, sourceFile.size, sourceFile.type);
  const now = Date.now();
  const pendingPreview: CachedAttachmentPreview = {
    attachmentId: uploadedFile.id,
    path: uploadedFile.path,
    originalName: uploadedFile.originalName,
    mimeType: uploadedFile.mimeType,
    size: uploadedFile.size,
    thumbnailVariant: THUMBNAIL_CACHE_VARIANT,
    thumbnailWidth: uploadDimensions?.width ?? THUMBNAIL_HEIGHT_PX,
    thumbnailHeight: uploadDimensions?.height ?? THUMBNAIL_HEIGHT_PX,
    fullBlob,
    totalBytes: fullBlob.size,
    createdAt: now,
    lastAccessedAt: now,
  };
  // Only the upload in flight is held in memory: a chip can ask for these
  // bytes before the store finishes, and afterwards the bounded IndexedDB
  // cache serves them. Anything retained past this call would be a copy no
  // eviction reaches.
  rememberMemoryPreview(pendingPreview);
  try {
    const thumbnail = await createThumbnailBlob(sourceFile);
    const totalBytes = fullBlob.size + (thumbnail?.blob.size ?? 0);

    const db = await getDatabase();
    const cachedPreview: CachedAttachmentPreview = {
      ...pendingPreview,
      thumbnailWidth: thumbnail?.width ?? pendingPreview.thumbnailWidth,
      thumbnailHeight: thumbnail?.height ?? pendingPreview.thumbnailHeight,
      thumbnailBlob: thumbnail?.blob,
      totalBytes,
      lastAccessedAt: Date.now(),
    };
    rememberMemoryPreview(cachedPreview);
    await writePreview(db, uploadedFile.id, cachedPreview);
    if (uploadedFile.path !== uploadedFile.id) {
      await putEntryWithKey<CachedAttachmentAlias>(
        db,
        STORE_NAME,
        uploadedFile.path,
        aliasTo(uploadedFile.id),
      ).catch(() => {});
    }

    const cacheSize = await calculateCacheSize(db);
    if (cacheSize > MAX_CACHE_BYTES) {
      await evictOldestEntries(db, cacheSize - MAX_CACHE_BYTES);
    }
  } finally {
    forgetMemoryPreview(pendingPreview);
  }
}

/**
 * Moves a preview stored before previews were keyed by attachment id to its
 * attachment id, leaving its path pointing at the new home.
 */
async function moveToAttachmentId(
  db: IDBDatabase,
  legacyKey: string,
  preview: CachedAttachmentPreview,
): Promise<void> {
  const { metadata, blobs } = splitPreview(preview);
  const tx = db.transaction([STORE_NAME, BLOB_STORE_NAME], "readwrite");
  const records = tx.objectStore(STORE_NAME);
  const blobStore = tx.objectStore(BLOB_STORE_NAME);
  records.put(metadata, preview.attachmentId);
  blobStore.put(blobs, preview.attachmentId);
  records.put(aliasTo(preview.attachmentId), legacyKey);
  blobStore.delete(legacyKey);
  await completion(tx);
}

export async function loadCachedAttachmentPreview(
  attachmentId: string,
  legacyPath?: string,
): Promise<CachedAttachmentPreview | null> {
  const memoryEntry =
    memoryPreviews.get(attachmentId) ??
    (legacyPath && legacyPath !== attachmentId
      ? memoryPreviews.get(legacyPath)
      : undefined);
  if (memoryEntry) {
    return { ...memoryEntry, lastAccessedAt: Date.now() };
  }

  const db = await getDatabase();
  const stored =
    (await readPreview(db, attachmentId)) ??
    (legacyPath && legacyPath !== attachmentId
      ? await readPreview(db, legacyPath)
      : null);
  if (!stored) return null;
  let storageKey = stored.key;
  let entry = stored.preview;
  if (!stored.viaAlias && storageKey !== attachmentId) {
    entry = { ...entry, attachmentId };
    await moveToAttachmentId(db, storageKey, entry);
    storageKey = attachmentId;
  }

  if (needsThumbnailRefresh(entry)) {
    const refreshedThumbnail = await createThumbnailBlob(entry.fullBlob);
    if (refreshedThumbnail) {
      entry = {
        ...entry,
        thumbnailWidth: refreshedThumbnail.width,
        thumbnailHeight: refreshedThumbnail.height,
        thumbnailBlob: refreshedThumbnail.blob,
        thumbnailVariant: THUMBNAIL_CACHE_VARIANT,
      };
      await writePreview(db, storageKey, entry);
    }
  }

  const updated = {
    ...entry,
    lastAccessedAt: Date.now(),
  };
  // Touch only the blob-free record; rewriting the blobs would copy them.
  await putEntryWithKey<CachedAttachmentMetadata>(
    db,
    STORE_NAME,
    storageKey,
    splitPreview(updated).metadata,
  );
  return updated;
}

export async function deleteCachedAttachmentPreview(
  path: string,
): Promise<void> {
  const memoryEntry = memoryPreviews.get(path);
  if (memoryEntry) {
    memoryPreviews.delete(memoryEntry.attachmentId);
    if (memoryEntry.path) memoryPreviews.delete(memoryEntry.path);
  } else {
    memoryPreviews.delete(path);
  }
  const db = await getDatabase();
  // A path may hold the preview itself or a pointer to it; both go.
  const aliased = await readAlias(db, path);
  if (aliased) await deleteStored(db, aliased);
  await deleteStored(db, path);
}

export function isCacheableAttachmentMimeType(mimeType: string): boolean {
  return isImageMimeType(mimeType);
}
