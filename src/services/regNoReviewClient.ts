import type { ReviewResult } from "../types/ReviewResult";
import type { Issue } from "../types/Issue";
import type { IssueSeverity } from "../types/DocumentReview";
import { isHeadCode, type HeadCode } from "../types/Head";
import {
  parseReviewToResult,
  type ReportMetadata,
  PdfReviewError,
} from "./pdfReviewClient";
import type {
  LimsHeader,
  LimsRow,
  RegNoFetchReviewFailure,
  RegNoFetchReviewResponse,
  RegNoFetchReviewSuccess,
  CoaUpdateRequest,
  CoaUpdateResponse,
} from "../types/RegNoReview";

const FETCH_REVIEW_ENDPOINT = "http://192.168.137.228:5165/api/find/fetch-review";
const UPDATE_ENDPOINT       = "http://192.168.137.228:5165/api/find/update";

// ─── System prompt tuned for LIMS table rows (not PDFs) ───────────────────────
const REG_NO_SYSTEM_PROMPT = `You are a strict laboratory-report data validator for EFRAC (Edward Food Research & Analysis Centre Ltd), a NABL-accredited food-testing laboratory. You are reviewing a single LIMS report identified by its registration number. You will receive structured data — a report header and a list of test-parameter rows pulled directly from the LIMS database (Trn105 joined with Trn205). Return ONLY a single valid JSON object — no prose, no commentary, no markdown code fences.

────────────────────────────────────────────────────────
SEVERITY DEFINITIONS  (use exactly these strings)
────────────────────────────────────────────────────────
"error"      → BLOCK: report cannot be approved until resolved.
"warning"    → WARN: should be fixed before issue; reviewer must acknowledge.
"suggestion" → INFO: no action required but worth noting.

────────────────────────────────────────────────────────
IMPORTANT: FIELD NAMING IN SOURCE DATA
────────────────────────────────────────────────────────
Each row in the source data contains TWO group-related fields:
• "groupCode"  — the raw database code stored in Trn2groupcd (e.g. "GP01", "CH02"). Use THIS value in evidence.targetRows[].groupCode.
• "groupName"  — the human-readable description (e.g. "Physical Parameters"). Use this only for display in titles/descriptions.
When populating evidence.targetRows, you MUST use the raw "groupCode" value, never the "groupName". The UI uses groupCode to write back to the database.

────────────────────────────────────────────────────────
DATA-VALIDATION RULES TO APPLY
────────────────────────────────────────────────────────

DATE LOGIC
• Sample Received Date ≤ Sample Registration Date. Inversion → "error".
• Any other obviously inverted date sequence → "error".

SPEC & VERDICT CONSISTENCY
• Every numeric "Result" must be compared against its "Requirements" (NMT / NLT / range).
  - Result clearly breaches spec → "error".
  - Result within spec but obviously misclassified → "error".
• Qualifier-bearing results (BLQ, BDL, "< X"): treat as passing NMT specs only when qualifier threshold ≤ spec limit. Otherwise → "error".

LOQ / UNIT HYGIENE
• Every numeric result must carry a unit of measure (UOM). Missing UOM → "error".
• LOQ and Result must share the same unit. Unit mismatch → "error".
• LOQ greater than Result with no explanation → "warning".

INTER-PARAMETER NUMERICAL RULES (apply whichever are checkable from the visible rows)
• Cation–anion ionic balance must be within ±10 %. Deviation > 10 % → "warning"; > 20 % → "error".
• Total Fat ≈ SFA + MUFA + PUFA + Trans Fat within ±10 %. Mismatch → "warning".
• Total Hardness ≈ (Ca hardness + Mg hardness) within ±5 %. Mismatch → "warning".

UNIT OF MEASURE
• UOM must be consistent across rows for the same parameter. Inconsistency → "warning" (translatable) or "error" (not translatable).
• Non-canonical but translatable UoM → "suggestion" with the canonical form stated.

────────────────────────────────────────────────────────
VOICE RULES
────────────────────────────────────────────────────────
For each finding:
1. Title: one-line issue summary, 12–20 words.
2. Description: 2–3 sentences. Cite the specific groupCode, parameter, value, and rule. No semicolons. No editorialising.
3. Suggestion: one sentence telling the reviewer exactly what to do.

────────────────────────────────────────────────────────
EVALUATION HEADS  (classify every finding into exactly one)
────────────────────────────────────────────────────────
IDENTITY    — Identity & document integrity (report number, batch ID, completeness)
DATES       — Date & workflow logic
PARAMS      — Inter-parameter conflicts (spec vs result, LOQ, UoM, sums)
MATRIX      — Matrix vs parameter applicability
REGULATORY  — Regulatory & method references
HYGIENE     — Formatting, language, decimal/sig-fig hygiene

────────────────────────────────────────────────────────
OUTPUT SCHEMA  (MUST follow exactly)
────────────────────────────────────────────────────────
{
  "documents": [
    {
      "fileName": "<regNo / Report No>",
      "score": <integer 0-100>,
      "summary": "<2-3 sentence overall assessment>",
      "metadata": {
        "reportNo":          "<Report number, else null>",
        "ulr":               null,
        "customer":          "<Customer / Client name, else null>",
        "sample":            "<Sample / Product name, else null>",
        "sampleId":          "<Batch No / Sample ID if present, else null>",
        "issuedDate":        null,
        "samplingDate":      "<Sampling date if present, else null>",
        "receiptDate":       "<Sample received date, else null>",
        "analysisStartDate": null,
        "analysisEndDate":   null,
        "subLabs":           null,
        "documentClass":     null,
        "nabl":              null,
        "method":            null,
        "matrix":            "<Sample type / matrix, else null>",
        "version":           null
      },
      "issues": [
        {
          "headCode": "IDENTITY" | "DATES" | "PARAMS" | "MATRIX" | "REGULATORY" | "HYGIENE",
          "severity": "error" | "warning" | "suggestion",
          "title": "<short title>",
          "description": "<what is wrong and why it matters>",
          "location": "<e.g. 'GroupCode G01 / Parameter Assay'>",
          "suggestion": "<concrete fix>",
          "evidence": {
            "compared": [
              { "label": "GroupCode",  "new": "<groupCode>" },
              { "label": "Parameter",  "new": "<parameter>" },
              { "label": "Result",     "old": "<current result>", "new": "<suggested corrected result, if applicable>" }
            ],
            "verdict":     "<one-line reason the rule fired>",
            "rule":        { "code": "<short rule code, e.g. R-SPEC-01>", "version": "v1.0" },
            "targetRows": [
              { "groupCode": "<groupCode>", "parameter": "<parameter>", "suggestedResult": "<corrected result if you have one, else omit>" }
            ]
          }
        }
      ]
    }
  ],
  "overallScore": <integer 0-100, same as the single document's score>
}

Rules:
- Emit EXACTLY ONE entry in "documents" (this is a single report).
- score: 100 = ready to submit, 0 = unusable. Penalise missing required fields, compliance gaps, factual issues.
- Produce 4-8 issues, distributed across the heads where evidence exists. Keep each "description" and "suggestion" to 1-2 sentences (~240 chars each).
- Whenever a finding can be tied to one or more parameter rows, you MUST populate evidence.targetRows with the exact groupCode + parameter values that appear in the source data. This is how the UI lets reviewers fix the underlying record.
- All string values MUST be valid JSON: escape every internal double-quote as \\" and every newline as \\n.
- Output raw JSON only. Do not wrap in \`\`\` and do not add any text before or after. Do not truncate — finish every brace and bracket.`;

function newCorrelationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── /api/find/fetch-review transport ────────────────────────────────────────
async function fetchRegNoReview(
  regNo: string,
  signal?: AbortSignal,
): Promise<RegNoFetchReviewSuccess> {
  const correlationId = newCorrelationId();
  const body = {
    regNo: regNo.trim(),
    prompt: "Review this LIMS report for data-quality and field-level defects. Return JSON only.",
    systemPrompt: REG_NO_SYSTEM_PROMPT,
    modelOverride: null,
    maxTokensOverride: null,
    correlationId,
  };

  const res = await fetch(FETCH_REVIEW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  let payload: RegNoFetchReviewResponse | null = null;
  try {
    payload = (await res.json()) as RegNoFetchReviewResponse;
  } catch {
    // non-JSON failure
  }

  if (!res.ok || !payload || payload.success === false) {
    const failure: RegNoFetchReviewFailure =
      payload && payload.success === false
        ? payload
        : {
            correlationId,
            success: false,
            errorCode: res.status === 429 ? "AI_RATE_LIMIT" : "INTERNAL_ERROR",
            message:
              res.status === 429
                ? "Rate limit reached. Please retry in a moment."
                : `Request failed (${res.status}).`,
          };
    throw new PdfReviewError(failure, res.status);
  }

  return payload;
}

// ─── Extract targetRows from issue.evidence (read-only — does not mutate Issue type)

/**
 * Which LIMS column this finding is about.
 * Maps directly to the field names accepted by CoaUpdateRequest items.
 */
export type TargetField = "results" | "uom" | "loq" | "method" | "requirements";

export const TARGET_FIELD_LABEL: Record<TargetField, string> = {
  results:      "Result",
  uom:          "UOM",
  loq:          "LOQ",
  method:       "Method",
  requirements: "Requirements / Spec",
};

export interface IssueTargetRow {
  groupCode: string;
  parameter: string;
  /** Which column is broken — drives the editor field label and the PUT payload key. */
  fieldName: TargetField;
  suggestedValue?: string;
  /** @deprecated kept for backwards compat — use suggestedValue */
  suggestedResult?: string;
}

/**
 * Derives which LIMS column is affected from the issue's evidence.
 * Checks targetRows[].fieldName first, then infers from compared[] labels,
 * then falls back to rule code / head code heuristics.
 */
function deriveFieldName(
  ruleCode: string | undefined,
  headCode: string | undefined,
  compared: Array<{ label: string; old?: string; new?: string }>,
  explicitFieldName?: string,
): TargetField {
  // 1. Trust an explicit fieldName from the AI if it's a known column
  if (explicitFieldName) {
    const norm = explicitFieldName.toLowerCase().replace(/[\s_-]/g, "");
    if (norm === "uom" || norm === "unitofmeasure") return "uom";
    if (norm === "loq")                              return "loq";
    if (norm === "method")                           return "method";
    if (norm === "requirements" || norm === "spec")  return "requirements";
    if (norm === "results" || norm === "result")     return "results";
  }

  // 2. Scan compared[] labels for the broken field
  for (const c of compared) {
    const lab = c.label.toLowerCase().replace(/[\s_-]/g, "");
    if (lab === "uom" || lab === "unit" || lab === "unitofmeasure") return "uom";
    if (lab === "loq")                                               return "loq";
    if (lab === "method")                                            return "method";
    if (lab === "requirements" || lab === "spec" || lab === "specification") return "requirements";
    // "result" label → results column (keep last so UOM/LOQ match first)
  }

  // 3. Rule-code heuristics  (e.g. R-UOM-01, R-LOQ-02, R-REG-01 …)
  const rc = (ruleCode ?? "").toUpperCase();
  if (rc.includes("UOM") || rc.includes("UNIT"))   return "uom";
  if (rc.includes("LOQ"))                           return "loq";
  if (rc.includes("REG") || rc.includes("METHOD"))  return "method";
  if (rc.includes("SPEC") || rc.includes("REQ"))    return "requirements";

  // 4. HeadCode heuristics
  const hc = (headCode ?? "").toUpperCase();
  if (hc === "REGULATORY")                          return "method";
  if (hc === "HYGIENE")                             return "uom";

  // 5. Default — result column
  return "results";
}

/**
 * Pulls targetRows from an issue's evidence, falling back to evidence.compared
 * if the AI didn't populate the explicit field. Each row now carries a
 * `fieldName` so the editor shows the right input and the PUT sends the right key.
 */
export function extractTargetRows(issue: Issue): IssueTargetRow[] {
  const ev = issue.evidence as
    | (Issue["evidence"] & { targetRows?: unknown })
    | undefined;
  if (!ev) return [];

  const compared = ev.compared ?? [];
  const ruleCode  = ev.rule?.code;
  const headCode  = issue.headCode;

  const fromExplicit = Array.isArray(ev.targetRows) ? ev.targetRows : [];
  const explicit: IssueTargetRow[] = fromExplicit
    .map((r): IssueTargetRow | null => {
      if (!r || typeof r !== "object") return null;
      const o = r as Record<string, unknown>;
      const groupCode = typeof o.groupCode === "string" ? o.groupCode : "";
      const parameter = typeof o.parameter === "string" ? o.parameter : "";
      if (!groupCode || !parameter) return null;

      const explicitField = typeof o.fieldName === "string" ? o.fieldName : undefined;
      const fieldName = deriveFieldName(ruleCode, headCode, compared, explicitField);

      const suggestedValue =
        typeof o.suggestedResult === "string" ? o.suggestedResult :
        typeof o.suggestedValue  === "string" ? o.suggestedValue  : undefined;

      return { groupCode, parameter, fieldName, suggestedValue, suggestedResult: suggestedValue };
    })
    .filter((r): r is IssueTargetRow => r !== null);

  if (explicit.length > 0) return explicit;

  // Fallback: pull GroupCode + Parameter (+ optional value) from compared[]
  let groupCode = "";
  let parameter = "";
  let suggestedValue: string | undefined;
  for (const c of compared) {
    const lab = c.label.toLowerCase().replace(/[\s_-]/g, "");
    if (lab === "groupcode" && typeof c.new === "string") groupCode = c.new;
    else if (lab === "parameter" && typeof c.new === "string") parameter = c.new;
    else if (typeof c.new === "string") suggestedValue = c.new; // capture last non-identity field
  }
  if (groupCode && parameter) {
    const fieldName = deriveFieldName(ruleCode, headCode, compared);
    return [{ groupCode, parameter, fieldName, suggestedValue, suggestedResult: suggestedValue }];
  }
  return [];
}

// ─── Public entry point — same return shape as runPdfReview ──────────────────
export interface RegNoReviewBundle {
  result: ReviewResult;
  metadata: ReportMetadata[];
  correlationId: string;
  model: string;
  rows: LimsRow[];
  header: LimsHeader | null;
  regNo: string;
}

export async function runRegNoReview(
  regNo: string,
  signal?: AbortSignal,
): Promise<RegNoReviewBundle> {
  const success = await fetchRegNoReview(regNo, signal);

  // Reuse the PDF flow's parser — schema is identical.
  const { result, metadata } = parseReviewToResult(
    success.review,
    [{ id: regNo, name: regNo }],
  );

  const rows: LimsRow[] = Array.isArray(success.data) ? success.data : [];

  // Derive header from the first row — LimsClient + LimsHeader fields are
  // repeated on every Trn205 row; we only need one copy for the UI card.
  const firstRow = rows[0] ?? null;
  const header: LimsHeader | null = firstRow
    ? {
        kindAttention:          firstRow.kindAttention,
        reportNo:               firstRow.reportNo,
        issueDate:              firstRow.issueDate,
        customerRef:            firstRow.customerRef,
        refDate:                firstRow.refDate,
        sampleReceivedDate:     firstRow.sampleReceivedDate,
        sampleRegistrationDate: firstRow.sampleRegistrationDate,
        sampleType:             firstRow.sampleType,
        mfgDate:                firstRow.mfgDate,
        batchNo:                firstRow.batchNo,
      }
    : null;

  return {
    result,
    metadata,
    correlationId: success.correlationId,
    model: success.model,
    rows,
    header,
    regNo,
  };
}

// ─── PUT /api/find/update ─────────────────────────────────────────────────────

export interface FieldEdit {
  groupCode: string;
  parameter: string;
  /** Which LIMS column to write — drives the exact key sent in the PUT body */
  fieldName: TargetField;
  value: string;
}

export async function updateRegNoResults(
  payload: { regNo: string; items: FieldEdit[]; changedBy?: string },
  signal?: AbortSignal,
): Promise<CoaUpdateResponse> {
  // Build the items array with each edit going to the correct column key
  const mappedItems = payload.items.map(({ groupCode, parameter, fieldName, value }) => ({
    groupCode,
    parameter,
    // Spread the value under the exact field name the backend expects
    [fieldName]: value,
  }));

  const res = await fetch(UPDATE_ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ regNo: payload.regNo, items: mappedItems, changedBy: payload.changedBy }),
    signal,
  });

  if (!res.ok) {
    let message = `Update failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch { /* non-JSON */ }
    throw new Error(message);
  }
  return (await res.json()) as CoaUpdateResponse;
}

// Re-export so consumers don't need two imports
export { isHeadCode };
export type { HeadCode, IssueSeverity };