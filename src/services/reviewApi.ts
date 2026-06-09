/**
 * HTTP client for the backend-persisted review store.
 *
 * Mirrors the shape of services/reviewHistoryStore.ts so swapping IndexedDB
 * for the DB-backed implementation is a one-line import change. See
 * docs/api-contract.md for the endpoints this calls.
 *
 * The backend host is read from VITE_REVIEW_API_BASE (Vite env). For local
 * development this defaults to the same origin as the AI endpoint.
 */

import type { ReviewResult } from "../types/ReviewResult";
import type { StoredReviewMeta } from "../types/StoredReview";
import type { Issue } from "../types/Issue";
import type { HeadCode } from "../types/Head";
import type { IssueSeverity } from "../types/DocumentReview";

const API_BASE =
  (import.meta.env?.VITE_REVIEW_API_BASE as string | undefined) ??
  "http://192.168.137.228:5165";

export type FindingAction = "pending" | "accepted" | "modified" | "rejected";

export interface FindingActionRecord {
  action: FindingAction;
  note?: string;
  modifiedBody?: string;
  actedBy?: string;
  actedAt?: string;
}

export interface RemoteFinding extends Issue {
  findingId: string;
  currentAction: FindingActionRecord;
}

export interface RemoteDocument {
  documentId: string;
  fileName: string;
  sizeBytes: number;
  score: number;
  summary: string;
  findings: RemoteFinding[];
}

export interface RemoteReview {
  reviewId: string;
  correlationId: string;
  model: string;
  overallScore: number;
  status: "open" | "in_review" | "approved" | "rejected" | "archived";
  reviewedAt: string;
  createdAt: string;
  documents: RemoteDocument[];
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch { /* non-JSON body */ }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

// ---- Reviews ----------------------------------------------------------------

export interface SaveReviewInput {
  result: ReviewResult;
  correlationId: string;
  model: string;
  files: { id: string; name: string; size: number; type: string; blob: Blob }[];
  inputTokens?: number;
  outputTokens?: number;
}

export async function saveReview(input: SaveReviewInput): Promise<{ reviewId: string }> {
  const form = new FormData();
  for (const f of input.files) {
    form.append("files", f.blob, f.name);
  }
  form.append("result", JSON.stringify(input.result));
  form.append("correlationId", input.correlationId);
  form.append("model", input.model);
  if (typeof input.inputTokens === "number")  form.append("inputTokens",  String(input.inputTokens));
  if (typeof input.outputTokens === "number") form.append("outputTokens", String(input.outputTokens));
  return jsonFetch<{ reviewId: string }>("/api/reviews", {
    method: "POST",
    body: form,
  });
}

export async function listReviewMetas(opts: { take?: number; skip?: number } = {}): Promise<StoredReviewMeta[]> {
  const params = new URLSearchParams();
  if (opts.take) params.set("take", String(opts.take));
  if (opts.skip) params.set("skip", String(opts.skip));
  const qs = params.toString() ? `?${params}` : "";
  const res = await jsonFetch<{
    items: Array<{
      reviewId: string;
      correlationId: string;
      createdAt: string;
      model: string;
      overallScore: number;
      fileCount: number;
      totalSizeBytes: number;
      fileNames: string[];
      errorCount: number;
      warningCount: number;
      suggestionCount: number;
    }>;
    total: number;
  }>(`/api/reviews${qs}`);
  return res.items.map((r) => ({
    id: r.reviewId,
    createdAt: Date.parse(r.createdAt),
    expiresAt: 0, // server-managed; not surfaced
    correlationId: r.correlationId,
    model: r.model,
    fileCount: r.fileCount,
    totalSize: r.totalSizeBytes,
    fileNames: r.fileNames,
    overallScore: r.overallScore,
    errorCount: r.errorCount,
    warningCount: r.warningCount,
    suggestionCount: r.suggestionCount,
  }));
}

export async function getReview(reviewId: string): Promise<RemoteReview> {
  return jsonFetch<RemoteReview>(`/api/reviews/${encodeURIComponent(reviewId)}`);
}

export async function deleteReview(reviewId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/reviews/${encodeURIComponent(reviewId)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Delete failed (${res.status})`);
  }
}

export function pdfUrl(reviewId: string, documentId: string): string {
  return `${API_BASE}/api/reviews/${encodeURIComponent(reviewId)}/pdf/${encodeURIComponent(documentId)}`;
}

export async function setReviewStatus(
  reviewId: string,
  status: "approved" | "rejected" | "archived" | "in_review",
  note?: string,
): Promise<void> {
  await jsonFetch(`/api/reviews/${encodeURIComponent(reviewId)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, note }),
  });
}

// ---- Finding actions --------------------------------------------------------

export async function recordAction(
  findingId: string,
  payload: { action: FindingAction; note?: string; modifiedBody?: string; actedBy?: string },
): Promise<FindingActionRecord> {
  return jsonFetch<FindingActionRecord>(
    `/api/findings/${encodeURIComponent(findingId)}/actions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function listActions(findingId: string): Promise<FindingActionRecord[]> {
  return jsonFetch<FindingActionRecord[]>(
    `/api/findings/${encodeURIComponent(findingId)}/actions`,
  );
}

// ---- Helper: head-code roll-ups, if needed by callers -----------------------

export function countByHead(findings: RemoteFinding[]): Record<HeadCode | "uncategorised", number> {
  const out: Record<string, number> = {};
  for (const f of findings) {
    const key = f.headCode ?? "uncategorised";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out as Record<HeadCode | "uncategorised", number>;
}

export function countBySeverity(findings: RemoteFinding[]): Record<IssueSeverity, number> {
  const out: Record<IssueSeverity, number> = { error: 0, warning: 0, suggestion: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}
