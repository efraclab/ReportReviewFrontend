import type { Issue } from "./Issue";

export type IssueSeverity = "error" | "warning" | "suggestion";

export interface DocumentReview {
  fileName: string;
  fileId: string;
  score: number;
  summary: string;
  issues: Issue[];
}

