export interface PdfReviewRequest {
  files: File[];
  prompt: string;
  systemPrompt?: string;
  modelOverride?: string;
  maxTokensOverride?: number;
  correlationId?: string;
  deleteFilesAfter?: boolean;
}

export interface PdfReviewFileMeta {
  fileId: string;
  filename: string;
  sizeBytes: number;
  deleted: boolean;
}

export interface PdfReviewUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface PdfReviewSuccess {
  correlationId: string;
  success: true;
  review: string;
  files: PdfReviewFileMeta[];
  usage: PdfReviewUsage;
  model: string;
  processedAt: string;
}

export type PdfReviewErrorCode =
  | "VALIDATION_ERROR"
  | "AI_RATE_LIMIT"
  | "AI_TIMEOUT"
  | "ANTHROPIC_AUTH_FAILURE"
  | "INTERNAL_ERROR"
  | string;

export interface PdfReviewFailure {
  correlationId: string;
  success: false;
  errorCode: PdfReviewErrorCode;
  message: string;
  validationErrors?: Record<string, string[]>;
  occurredAt?: string;
}

export type PdfReviewResponse = PdfReviewSuccess | PdfReviewFailure;
