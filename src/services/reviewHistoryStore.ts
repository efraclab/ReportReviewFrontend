import type { ReviewResult } from "../types/ReviewResult";
import type {
  StoredFileRecord,
  StoredReview,
  StoredReviewMeta,
} from "../types/StoredReview";

const DB_NAME = "lims-review";
const DB_VERSION = 1;
const STORE = "reviews";

export const HISTORY_TTL_DAYS = 7;
export const HISTORY_MAX_ENTRIES = 10;

const TTL_MS = HISTORY_TTL_DAYS * 24 * 60 * 60 * 1000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readAll(): Promise<StoredReview[]> {
  return openDb().then(
    (db) =>
      new Promise<StoredReview[]>((resolve, reject) => {
        const t = db.transaction(STORE, "readonly");
        const req = t.objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as StoredReview[]) ?? []);
        req.onerror = () => reject(req.error);
      }),
  );
}

function put(entry: StoredReview): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, "readwrite");
        t.objectStore(STORE).put(entry);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

function del(id: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, "readwrite");
        t.objectStore(STORE).delete(id);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

function toMeta(e: StoredReview): StoredReviewMeta {
  const issues = e.result.documents.flatMap((d) => d.issues);
  return {
    id: e.id,
    createdAt: e.createdAt,
    expiresAt: e.expiresAt,
    correlationId: e.correlationId,
    model: e.model,
    fileCount: e.files.length,
    totalSize: e.files.reduce((s, f) => s + f.size, 0),
    fileNames: e.files.map((f) => f.name),
    overallScore: e.result.overallScore,
    errorCount: issues.filter((i) => i.severity === "error").length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
    suggestionCount: issues.filter((i) => i.severity === "suggestion").length,
  };
}

async function trimToMax(): Promise<void> {
  const all = await readAll();
  if (all.length <= HISTORY_MAX_ENTRIES) return;
  const sorted = all.sort((a, b) => b.createdAt - a.createdAt);
  for (const e of sorted.slice(HISTORY_MAX_ENTRIES)) {
    await del(e.id);
  }
}

export async function pruneExpired(): Promise<number> {
  const all = await readAll();
  const now = Date.now();
  const expired = all.filter((e) => e.expiresAt < now);
  for (const e of expired) await del(e.id);
  await trimToMax();
  return expired.length;
}

export async function saveReview(input: {
  result: ReviewResult;
  correlationId: string;
  model: string;
  files: StoredFileRecord[];
}): Promise<StoredReview> {
  const now = Date.now();
  const entry: StoredReview = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `r-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: now,
    expiresAt: now + TTL_MS,
    correlationId: input.correlationId,
    model: input.model,
    result: input.result,
    files: input.files,
  };
  await put(entry);
  await trimToMax();
  return entry;
}

export async function listReviewMetas(): Promise<StoredReviewMeta[]> {
  const all = await readAll();
  return all.sort((a, b) => b.createdAt - a.createdAt).map(toMeta);
}

export async function getReview(id: string): Promise<StoredReview | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readonly");
    const req = t.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as StoredReview | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteReview(id: string): Promise<void> {
  await del(id);
}

export async function clearAllReviews(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}