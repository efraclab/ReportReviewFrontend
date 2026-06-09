import type { ReviewResult } from "./ReviewResult";

export interface StoredFileRecord {
  id: string;
  name: string;
  size: number;
  type: string;
  blob: Blob;
}

export interface StoredReview {
  id: string;
  createdAt: number;
  expiresAt: number;
  correlationId: string;
  model: string;
  result: ReviewResult;
  files: StoredFileRecord[];
}

// Lightweight projection used for list views (no blobs).
export interface StoredReviewMeta {
  id: string;
  createdAt: number;
  expiresAt: number;
  correlationId: string;
  model: string;
  fileCount: number;
  totalSize: number;
  fileNames: string[];
  overallScore: number;
  errorCount: number;
  warningCount: number;
  suggestionCount: number;
}
