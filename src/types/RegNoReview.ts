/**
 * Types for the "review by registration number" flow.
 *
 * Backend endpoint:  POST /api/find/fetch-review
 *   Body: { regNo, prompt, systemPrompt, modelOverride, maxTokensOverride, correlationId }
 *
 *   Server runs SQL against Trn105 / Trn205 / OcustMst / Ocodemst, sends rows to AI,
 *   and returns the AI review string plus the raw LIMS rows so the frontend can
 *   render the data table independently.
 *
 * Update endpoint:   PUT /api/find/update
 *   Body: { regNo, header?, items? }
 *   Only non-null fields in header / items are written — omitted fields are left untouched.
 *   Returns per-item outcomes (rowsAffected, skipped, skipReason).
 */

// ── Raw LIMS row (Trn205 joined with Trn105 / OcustMst / Ocodemst) ──────────

/** Client / customer master fields from OcustMst. */
export interface LimsClient {
  issuedToClientName:  string | null;
  clientUnit:          string | null;
  clientAddress1:      string | null;
  clientAddress2:      string | null;
  clientAddress3:      string | null;
  clientCity:          string | null;
  clientPin:           string | null;
  clientState:         string | null;
  clientCountry:       string | null;
}

/** Report / header fields from Trn105. */
export interface LimsHeader {
  kindAttention:          string | null;
  reportNo:               string | null;
  issueDate:              string | null;   // ISO date string
  customerRef:            string | null;
  refDate:                string | null;   // ISO date string
  sampleReceivedDate:     string | null;   // ISO date string
  sampleRegistrationDate: string | null;   // ISO date string
  sampleType:             string | null;
  mfgDate:                string | null;   // ISO date string
  batchNo:                string | null;
}

/** Sample / analysis fields from Trn205. */
export interface LimsSample {
  sampleRegistrationNumber:  string | null;
  samplingMethod:            string | null;
  sampleQuantityReceived:    number | null;
  sampleQuantityReceivedUnit:string | null;
  sampleQuantityUsed:        number | null;
  sampleQuantityUsedUnit:    string | null;
  samplerName:               string | null;
  analysisStartDate:         string | null;   // ISO date string
  analysisCompletionDate:    string | null;   // ISO date string
}

/** One parameter / result row from Trn205. */
export interface LimsRow extends LimsClient, LimsHeader, LimsSample {
  groupCode:    string | null;
  groupName:    string | null;
  parameter:    string | null;
  uom:          string | null;
  method:       string | null;
  loq:          string | null;
  requirements: string | null;
  results:      string | null;
  remarks:      string | null;
}

// ── Fetch + review ────────────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens:  number;
  outputTokens: number;
}

/** HTTP 200 shape returned by POST /api/find/fetch-review. */
export interface RegNoFetchReviewSuccess {
  correlationId: string;
  success:       true;
  regNo:         string;
  rowCount:      number;
  /** Raw LIMS rows that were sent to the AI. */
  data:          LimsRow[];
  /** AI review — structured JSON string (parse to ValidationResult). */
  review:        string;
  usage:         TokenUsage;
  model:         string;
  processedAt:   string;   // ISO date-time string
}

export interface RegNoFetchReviewFailure {
  correlationId: string;
  success:       false;
  errorCode:     string;
  message:       string;
}

export type RegNoFetchReviewResponse =
  | RegNoFetchReviewSuccess
  | RegNoFetchReviewFailure;

// ── Update request ────────────────────────────────────────────────────────────

/**
 * Updatable Trn105 header fields.
 * All fields are optional — only non-null values are written to the DB.
 */
export interface CoaHeaderUpdate {
  kindAttention?:          string | null;
  customerRef?:            string | null;
  sampleReceivedDate?:     string | null;   // ISO date string
  sampleRegistrationDate?: string | null;   // ISO date string
  sampleType?:             string | null;
  mfgDate?:                string | null;   // ISO date string
  batchNo?:                string | null;
}

/**
 * Updatable Trn205 detail fields for a single parameter row.
 * groupCode + parameter are required row keys; everything else is optional.
 */
export interface CoaDetailUpdate {
  /** Row key — required. */
  groupCode:  string;
  /** Row key — required. */
  parameter:  string;

  // Updatable columns — omit or set null to leave unchanged
  uom?:                      string | null;
  method?:                   string | null;
  loq?:                      string | null;
  requirements?:             string | null;
  results?:                  string | null;
  remarks?:                  string | null;
  analysisStartDate?:        string | null;   // ISO date string
  analysisCompletionDate?:   string | null;   // ISO date string
  sampleQuantityReceived?:   number | null;
  sampleQuantityUnit?:       string | null;
  samplingMethod?:           string | null;
  sampleRegistrationNumber?: string | null;
  issueDate?:                string | null;   // ISO date string
}

export interface CoaUpdateRequest {
  regNo:   string;
  /** Optional header-level update targeting Trn105. */
  header?: CoaHeaderUpdate | null;
  /** Optional list of detail-row updates targeting Trn205. */
  items?:  CoaDetailUpdate[];
}

// ── Update response ───────────────────────────────────────────────────────────

/** Outcome for a single CoaDetailUpdate item. */
export interface CoaDetailUpdateResult {
  groupCode:    string;
  parameter:    string;
  /** DB rows matched and updated (0 = row not found). */
  rowsAffected: number;
  /** True when the item was skipped (no updatable fields, blank keys, etc.). */
  skipped:      boolean;
  skipReason:   string | null;
}

/** HTTP 200 shape returned by PUT /api/find/update. */
export interface CoaUpdateResponse {
  regNo:               string;
  success:             boolean;
  /** Trn105 rows touched by the header update (0 or 1). */
  headerRowsAffected:  number;
  /** Total Trn205 rows touched across all detail items. */
  detailRowsAffected:  number;
  /** Per-item outcomes — check skipped + rowsAffected per entry. */
  itemResults:         CoaDetailUpdateResult[];
  updatedAt:           string;   // ISO date-time string
}