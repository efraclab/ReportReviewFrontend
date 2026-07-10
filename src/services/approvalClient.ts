// ─── approvalClient.ts ────────────────────────────────────────────────────────
// Thin HTTP client for the approval + audit-log endpoints added to the backend.
// All functions are pure async helpers; they throw on non-OK responses.

import { BACKEND_URL} from "../config";

const BASE = `${BACKEND_URL}/api/find`;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApprovalStatus = "Approved" | "Rejected" | "Pending";

export interface CoaApprovalRecord {
  id: number;
  regNo: string;
  /** "Approved" | "Rejected" | "Pending" */
  status: ApprovalStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;   // ISO datetime string from the server
  createdAt: string;
  updatedAt: string;
}

export interface SetApprovalPayload {
  regNo: string;
  status: ApprovalStatus;
  reviewedBy: string;
  notes?: string;
}

export interface AuditLogEntry {
  id: number;
  regNo: string;
  /** "DetailUpdate" | "HeaderUpdate" | "StatusChange" */
  actionType: string;
  groupCode: string | null;
  parameter: string | null;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string | null;
  changedAt: string;
  notes: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal });
  if (res.status === 404) return null as unknown as T;
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const b = await res.json(); if (b?.message) msg = b.message; } catch { /* noop */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const b = await res.json(); if (b?.message) msg = b.message; } catch { /* noop */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetches the current approval record for a regNo.
 * Returns `null` when the report has never been reviewed (implicitly Pending).
 */
export async function getApproval(
  regNo: string,
  signal?: AbortSignal,
): Promise<CoaApprovalRecord | null> {
  // Query param — matches [FromQuery] string regNo on the controller
  const url = `${BASE}/approval?regNo=${encodeURIComponent(regNo.trim())}`;
  const res = await fetch(url, { signal });
  if (res.status === 404) return null;
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const b = await res.json(); if (b?.message) msg = b.message; } catch { /* noop */ }
    throw new Error(msg);
  }
  return res.json() as Promise<CoaApprovalRecord>;
}

/**
 * Creates or updates the approval status.
 * `reviewedBy` should be the current user's display name or login.
 */
export async function setApproval(
  payload: SetApprovalPayload,
  signal?: AbortSignal,
): Promise<CoaApprovalRecord> {
  return apiPost<CoaApprovalRecord>("/approval", payload, signal);
}

/**
 * Returns the full field-level audit trail for a regNo, newest-first.
 * Includes DetailUpdate, HeaderUpdate, and StatusChange entries.
 * Returns an empty array when no logs exist yet.
 *
 * regNo is sent in the POST body (not the URL) to avoid ASP.NET Core's
 * middleware decoding %2F back to / and breaking route matching.
 */
export async function getAuditLogs(
  regNo: string,
  signal?: AbortSignal,
): Promise<AuditLogEntry[]> {
  const res = await fetch(`${BASE}/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ regNo: regNo.trim() }),
    signal,
  });

  // 404 → no logs yet, return empty array
  if (res.status === 404) return [];

  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const b = await res.json(); if (b?.message) msg = b.message; } catch { /* noop */ }
    throw new Error(msg);
  }

  const data = await res.json();

  // Unwrap if the server wraps the array in an envelope object
  if (Array.isArray(data)) return data as AuditLogEntry[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const unwrapped = obj["data"] ?? obj["logs"] ?? obj["auditLogs"] ?? obj["items"] ?? obj["results"];
    if (Array.isArray(unwrapped)) return unwrapped as AuditLogEntry[];
  }

  // Fallback — log unexpected shape in dev, return empty
  console.warn("[approvalClient] getAuditLogs: unexpected response shape", data);
  return [];
}

// ─── Derived helpers ──────────────────────────────────────────────────────────

/** Returns a human-readable label and colour tokens for a status value. */
export function statusMeta(status: ApprovalStatus | null | undefined): {
  label: string;
  colorClass: string;    // Tailwind text colour
  bgClass: string;       // Tailwind background
  borderClass: string;   // Tailwind border
} {
  switch (status) {
    case "Approved":
      return { label: "Approved", colorClass: "text-green-700",  bgClass: "bg-green-50",  borderClass: "border-green-200" };
    case "Rejected":
      return { label: "Rejected", colorClass: "text-red-700",    bgClass: "bg-red-50",    borderClass: "border-red-200"   };
    default:
      return { label: "Pending",  colorClass: "text-amber-700",  bgClass: "bg-amber-50",  borderClass: "border-amber-200" };
  }
}