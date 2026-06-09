import type {
  PdfReviewFailure,
  PdfReviewRequest,
  PdfReviewResponse,
  PdfReviewSuccess,
} from "../types/PdfReview";
import type { ReviewResult } from "../types/ReviewResult";
import type { Issue, IssueEvidence, IssueEvidenceCompared, IssueEvidenceTraceStep } from "../types/Issue";
import type { IssueSeverity } from "../types/DocumentReview";
import { isHeadCode, type HeadCode } from "../types/Head";

const ENDPOINT = "http://192.168.137.228:5165/api/pdf-review/process";

// ─── Rich EFRAC prompt (new) ──────────────────────────────────────────────────
const STRUCTURED_PROMPT = `You are a strict laboratory-report data validator for EFRAC (Edward Food Research & Analysis Centre Ltd), a NABL-accredited food-testing laboratory. You review every PDF I attach for data-quality and field-level defects only. Return ONLY a single valid JSON object — no prose, no commentary, no markdown code fences.
 
────────────────────────────────────────────────────────
SEVERITY DEFINITIONS  (use exactly these strings)
────────────────────────────────────────────────────────
"error"      → BLOCK: report cannot be approved until resolved.
               Examples: inverted date sequence, verdict contradicts numeric result,
               LOD > LOQ, missing UoM on a numeric result, calibration expired before analysis.
"warning"    → WARN: should be fixed before issue; reviewer must acknowledge.
               Examples: AMVR–AMVP gap < 21 days, translatable non-canonical UoM,
               amendment date drift, borderline MU case, cation–anion balance off > 10 %.
"suggestion" → INFO: no action required but worth noting.
               Examples: analysis performed on a Sunday, turnaround time unusually long,
               significant-figures inconsistency that does not affect verdict.
 
────────────────────────────────────────────────────────
DATA-VALIDATION RULES TO APPLY  (from EFRAC L1-M2, M4, M6, M7, M8)
────────────────────────────────────────────────────────
 
DATE LOGIC (L1-M2)
• Date sequence must hold: Sampling ≤ Receipt ≤ Registration ≤ Analysis Start ≤ Analysis Completion ≤ Issue Date. Any inversion → "error".
• Calibration validity end date must be ≥ Analysis Completion date for every instrument cited. Expired calibration during analysis → "error" (ROUTINE_COA) or "warning" (other classes).
• For Pharma method-validation reports (AMVR referencing AMVP): gap between AMVP issue date and AMVR issue date must be ≥ 21 days. Gap < 21 days → "warning".
• Amendment (v2, v3 …): if analysis completion date is unchanged between versions but result values changed → "error".
• Analysis on a Sunday or public holiday → "suggestion" (flag only, do not block).
• Turnaround time (Receipt → Issue) exceeding matrix-typical norms → "suggestion".
 
INTER-PARAMETER NUMERICAL RULES (L1-M4 — apply whichever are checkable from visible data)
• Cation–anion ionic balance: must be within ±10 %. Deviation > 10 % → "warning"; > 20 % → "error".
• TDS vs Conductivity: TDS ≈ Conductivity × 0.55–0.75 (for water matrices). Outside range → "warning".
• Total Fat ≈ SFA + MUFA + PUFA + Trans Fat within ±10 %. Mismatch → "warning".
• Total Hardness ≈ (Ca hardness + Mg hardness) within ±5 %. Mismatch → "warning".
• Protein ≈ Kjeldahl N × conversion factor (5.7 for wheat, 6.38 for dairy, 6.25 default). Wrong factor or unexplained deviation → "warning".
• When multiple inter-parameter failures share a common upstream value (e.g., wrong unit of measure cascading into sum-balance failures), compose a single root-cause finding rather than listing each failure separately.
 
SPEC & VERDICT CONSISTENCY (L1-M6)
• Every numeric result must be compared against its stated specification (NMT / NLT / range). If result breaches spec but verdict says "Conforms" → "error". If result is within spec but verdict says "Does Not Conform" → "error".
• Qualifier-bearing results (BLQ, BDL, "< X"): treated as passing NMT specs only when the qualifier threshold ≤ spec limit. If qualifier threshold > spec limit and verdict is "Conforms" → "error".
• Decision rule with Measurement Uncertainty (MU): if result + MU crosses the spec limit, borderline verdict without explicit decision-rule declaration → "warning".
• Front-page summary verdict must reflect the worst-case verdict across all sub-lab sections. If front page says Conforms but any sub-lab section says Does Not Conform → "error".
 
LOQ / LOD / MU COMPLETENESS (L1-M7)
• Where a method requires LOQ: if LOQ is absent → "error".
• LOD must be ≤ LOQ. If LOD > LOQ → "error".
• LOQ and LOD must share the same unit of measure as the result. Unit mismatch → "error".
• For Pharma reports (decision-rule context): LOQ must be ≤ 10 % of the specification limit. LOQ > 10 % of spec → "error".
• MU value absent when decision rule is declared → "warning".
 
UNIT OF MEASURE HYGIENE (L1-M8)
• Every numeric result must carry a unit of measure. Missing UoM → "error".
• UoM must be consistent for the same parameter across pages and sub-lab sections. Inconsistency → "warning" if translatable (e.g., mg/L vs ppm for water), "error" if not translatable.
• Decimal separator must be consistent throughout (period or comma, not mixed) → "warning" if mixed.
• Significant figures must be consistent for the same parameter across versions or sub-lab sections. Inconsistency → "suggestion".
• Non-canonical but translatable UoM (e.g., "ppm" instead of "mg/L" for water) → "suggestion" with the canonical form stated.
 
────────────────────────────────────────────────────────
VOICE RULES (follow exactly)
────────────────────────────────────────────────────────
For each finding:
1. Title: one-line issue summary, 12–20 words.
2. Description: 2–3 sentences. Cite specific values, dates, page numbers, and the rule being checked. Past tense for events, present tense for current state. No semicolons. No editorialising ("this is serious"). No speculation beyond the data.
3. Suggestion: one sentence telling the reviewer exactly what to do.
Expand abbreviations on first use within each finding (e.g., "Limit of Quantitation (LOQ)", "Measurement Uncertainty (MU)").
────────────────────────────────────────────────────────
EVALUATION HEADS  (classify every finding into exactly one)
────────────────────────────────────────────────────────
IDENTITY    — Identity & document integrity (ULR, report number, structural completeness, sample/batch ID)
DATES       — Date & workflow logic (sequence, sampling/receipt/analysis/issue dates, calibration validity)
PARAMS      — Inter-parameter conflicts (cation-anion, TDS/conductivity, fat sum, spec vs verdict, LOD/LOQ/MU, UoM)
MATRIX      — Matrix vs parameter applicability (e.g. parameter not relevant to matrix, wrong method for matrix)
REGULATORY  — Regulatory & method references (FSSAI codes, method versions, accreditation scope)
HYGIENE     — Signatory & hygiene (signatures, stamps, formatting, language, decimal/sig-fig hygiene)

Schema:
{
  "documents": [
    {
      "fileName": "<exact original filename>",
      "score": <integer 0-100>,
      "summary": "<2-3 sentence overall assessment>",
      "metadata": {
        "reportNo":          "<Report number / Certificate No — exact as printed, else null>",
        "ulr":               "<Unique Lab Reference / ULR number, else null>",
        "customer":          "<Customer / Client name, else null>",
        "sample":            "<Sample description / Product name, else null>",
        "sampleId":          "<Sample ID / Batch No / Lot No if present, else null>",
        "issuedDate":        "<Issue Date as printed e.g. 14/04/2026, else null>",
        "samplingDate":      "<Sampling / Collection date if present, else null>",
        "receiptDate":       "<Date of receipt at lab if present, else null>",
        "analysisStartDate": "<Analysis start date if present, else null>",
        "analysisEndDate":   "<Analysis completion / end date if present, else null>",
        "subLabs":           "<Sub-lab codes e.g. WC MB comma-separated, else null>",
        "documentClass":     "<Document class e.g. Routine COA Reanalysis v2, else null>",
        "nabl":              "<NABL accreditation number if shown, else null>",
        "method":            "<Primary test method / standard if shown, else null>",
        "matrix":            "<Sample matrix e.g. Packaged Drinking Water, else null>",
        "version":           "<Report version e.g. v1 v2 if shown, else null>"
      },
      "issues": [
        {
          "headCode": "IDENTITY" | "DATES" | "PARAMS" | "MATRIX" | "REGULATORY" | "HYGIENE",
          "severity": "error" | "warning" | "suggestion",
          "title": "<short title>",
          "description": "<what is wrong and why it matters>",
          "location": "<e.g. 'Page 3 — Section 5.2: Authorization'>",
          "suggestion": "<concrete fix>",
          "page": <1-based page number, optional>,
          "evidence": {
            "compared": [ { "label": "<field name>", "old": "<previous value>", "new": "<current value>" } ],
            "verdict":  "<one-line reason the rule fired>",
            "rule":     { "code": "<short rule code, e.g. R-DATE-01>", "version": "v1.0" }
          }
        }
      ]
    }
  ],
  "overallScore": <integer 0-100, average of document scores rounded>
}

Rules:
- Emit one entry in "documents" per uploaded PDF, in the order I uploaded them, using the exact original filename.
- score: 100 = ready to submit, 0 = unusable. Penalize missing required fields, compliance gaps, formatting inconsistencies, factual issues, structural problems.
- Produce 4-8 issues per document, distributed across the heads where evidence exists. Keep each "description" and "suggestion" to 1-2 sentences (max ~240 chars each).
- Always include "headCode". When a finding compares concrete values (a result vs spec, a date vs another date, a parameter across versions, etc.) you MUST populate "evidence.compared" with the actual values; otherwise omit "evidence" or include only "verdict" + "rule".
- Rule codes follow the EFRAC manual section: dates → R-DATE-NN, inter-parameter → R-PARAM-NN, spec/verdict → R-SPEC-NN, LOQ/MU → R-LOQ-NN, UoM → R-UOM-NN, identity → R-ID-NN, regulatory → R-REG-NN, hygiene → R-HYG-NN. Use v1.0 if unknown.
- "error" blocks acceptance; "warning" should be fixed; "suggestion" is a polish/improvement.
- All string values MUST be valid JSON: escape every internal double-quote as \\" and every newline as \\n. Do NOT include literal newlines, tabs, or unescaped quotes inside any string.
- Output raw JSON only. Do not wrap in \`\`\` and do not add any text before or after. Do not truncate — finish every brace and bracket.
- Every "documents" entry MUST include a "metadata" object. All metadata values must be strings or null — never omit the metadata object even if all values are null.`;


// ─── Metadata type ─────────────────────────────────────────────────────────
export interface ReportMetadata {
  reportNo:           string | null;
  ulr:                string | null;
  customer:           string | null;
  sample:             string | null;
  sampleId:           string | null;
  issuedDate:         string | null;
  samplingDate:       string | null;
  receiptDate:        string | null;
  analysisStartDate:  string | null;
  analysisEndDate:    string | null;
  subLabs:            string | null;
  documentClass:      string | null;
  nabl:               string | null;
  method:             string | null;
  matrix:             string | null;
  version:            string | null;
}

// ─── Error class ──────────────────────────────────────────────────────────────
export class PdfReviewError extends Error {
  readonly correlationId: string;
  readonly errorCode: string;
  readonly status: number;
  readonly validationErrors?: Record<string, string[]>;

  constructor(failure: PdfReviewFailure, status: number) {
    super(failure.message);
    this.name = "PdfReviewError";
    this.correlationId = failure.correlationId;
    this.errorCode = failure.errorCode;
    this.status = status;
    this.validationErrors = failure.validationErrors;
  }
}

function newCorrelationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Transport (identical to the old working client) ─────────────────────────
// NOTE: No maxTokensOverride — backend doesn't accept it.
export async function reviewPdfs(
  req: PdfReviewRequest,
  signal?: AbortSignal,
): Promise<PdfReviewSuccess> {
  const form = new FormData();
  for (const f of req.files) {
    form.append("files", f);
  }
  form.append("prompt", req.prompt);
  if (req.systemPrompt) form.append("systemPrompt", req.systemPrompt);
  if (req.modelOverride) form.append("modelOverride", req.modelOverride);
  // maxTokensOverride intentionally omitted — backend rejects it
  if (req.correlationId) form.append("correlationId", req.correlationId);
  if (typeof req.deleteFilesAfter === "boolean") {
    form.append("deleteFilesAfter", String(req.deleteFilesAfter));
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    body: form,
    signal,
  });

  let payload: PdfReviewResponse | null = null;
  try {
    payload = (await res.json()) as PdfReviewResponse;
  } catch {
    // non-JSON failure (network / HTML error page)
  }

  if (!res.ok || !payload || payload.success === false) {
    const failure: PdfReviewFailure =
      payload && payload.success === false
        ? payload
        : {
            correlationId: req.correlationId ?? "",
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

// ─── JSON recovery helpers (ported from new client) ──────────────────────────

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  // fallback: pull first balanced {...} block
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function extractBalancedJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function escapeControlCharsInStrings(input: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const code = ch.charCodeAt(0);
    if (inString) {
      if (escape) { out += ch; escape = false; continue; }
      if (ch === "\\") { out += ch; escape = true; continue; }
      if (ch === '"') { out += ch; inString = false; continue; }
      if (code === 0x0a) { out += "\\n"; continue; }
      if (code === 0x0d) { out += "\\r"; continue; }
      if (code === 0x09) { out += "\\t"; continue; }
      if (code === 0x08) { out += "\\b"; continue; }
      if (code === 0x0c) { out += "\\f"; continue; }
      if (code < 0x20)   { out += "\\u" + code.toString(16).padStart(4, "0"); continue; }
      out += ch;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    out += ch;
  }
  return out;
}

function recoverTruncatedJson(input: string): string {
  let inString = false;
  let escape = false;
  let stringOpenIndex = -1;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = false; stringOpenIndex = -1; continue; }
      continue;
    }
    if (ch === '"') { inString = true; stringOpenIndex = i; continue; }
  }

  let out = input;
  if (inString && stringOpenIndex >= 0) {
    out = out.slice(0, stringOpenIndex);
    out = out.replace(/\s+$/, "");
    out = out.replace(/,?\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*$/, "");
    out = out.replace(/[,:]\s*$/, "");
  }
  out = out.replace(/,\s*$/, "");

  const stack: ("{" | "[")[] = [];
  let inS = false;
  let esc = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (esc) { esc = false; continue; }
    if (inS) {
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inS = false; continue; }
      continue;
    }
    if (ch === '"') { inS = true; continue; }
    if (ch === "{") { stack.push("{"); continue; }
    if (ch === "[") { stack.push("["); continue; }
    if (ch === "}" || ch === "]") { stack.pop(); continue; }
  }

  while (true) {
    const trimmed = out.replace(/[\s,]+$/, "");
    const stripped = trimmed.replace(/"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*$/, "");
    if (stripped === trimmed) break;
    out = stripped;
  }

  for (let i = stack.length - 1; i >= 0; i--) {
    out += stack[i] === "{" ? "}" : "]";
  }
  return out;
}

function repairLikelyJson(input: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === "\u201c" || ch === "\u201d") { out += '"'; continue; }
    if (ch === ",") {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      if (input[j] === "}" || input[j] === "]") continue;
    }
    if ((ch === "}" || ch === "]") && i + 1 < input.length) {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) j++;
      const next = input[j];
      if (next === "{" || next === "[") { out += ch + ","; continue; }
    }
    out += ch;
  }
  return out;
}

function tryParseJson<T = unknown>(raw: string): T {
  const fenced = stripJsonFence(raw);
  const candidate = extractBalancedJson(fenced) ?? fenced;

  const stages: Array<{ name: string; fn: (s: string) => string }> = [
    { name: "raw",              fn: (s) => s },
    { name: "repair-likely",   fn: repairLikelyJson },
    { name: "escape-controls", fn: (s) => escapeControlCharsInStrings(repairLikelyJson(s)) },
    { name: "recover-truncated", fn: (s) => recoverTruncatedJson(escapeControlCharsInStrings(repairLikelyJson(s))) },
  ];

  let lastErr: unknown = null;
  for (const { name, fn } of stages) {
    try {
      const parsed = JSON.parse(fn(candidate)) as T;
      if (name !== "raw") console.warn(`[PdfReview] AI JSON recovered via stage: ${name}`);
      return parsed;
    } catch (err) {
      lastErr = err;
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const posMatch = msg.match(/position\s+(\d+)/i);
  const pos = posMatch ? Number(posMatch[1]) : -1;
  const snippet =
    pos >= 0
      ? candidate.slice(Math.max(0, pos - 60), Math.min(candidate.length, pos + 60))
      : candidate.slice(0, 200);
  throw new Error(
    `Could not parse AI response as JSON (${msg}). Context near position ${pos}: …${snippet}…`,
  );
}

// ─── Evidence sanitiser ───────────────────────────────────────────────────────
function sanitiseEvidence(raw: unknown): IssueEvidence | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;

  const compared: IssueEvidenceCompared[] = (Array.isArray(r.compared) ? r.compared : [])
    .map((c): IssueEvidenceCompared | null => {
      if (!c || typeof c !== "object") return null;
      const o = c as Record<string, unknown>;
      const label = typeof o.label === "string" && o.label.trim() ? o.label : null;
      if (!label) return null;
      return {
        label,
        old: typeof o.old === "string" ? o.old : undefined,
        new: typeof o.new === "string" ? o.new : undefined,
      };
    })
    .filter((x): x is IssueEvidenceCompared => x !== null);

  const trace: IssueEvidenceTraceStep[] = (Array.isArray(r.trace) ? r.trace : [])
    .map((t): IssueEvidenceTraceStep | null => {
      if (!t || typeof t !== "object") return null;
      const o = t as Record<string, unknown>;
      const tag  = typeof o.tag  === "string" && o.tag.trim()  ? o.tag  : null;
      const text = typeof o.text === "string" && o.text.trim() ? o.text : null;
      if (!tag || !text) return null;
      return { tag, text };
    })
    .filter((x): x is IssueEvidenceTraceStep => x !== null);

  let rule: IssueEvidence["rule"];
  if (r.rule && typeof r.rule === "object") {
    const ro = r.rule as Record<string, unknown>;
    const code = typeof ro.code === "string" && ro.code.trim() ? ro.code : null;
    if (code) rule = { code, version: typeof ro.version === "string" ? ro.version : undefined };
  }

  const linkedRecords = (Array.isArray(r.linkedRecords) ? r.linkedRecords : [])
    .filter((x): x is string => typeof x === "string");

  const verdict = typeof r.verdict === "string" && r.verdict.trim() ? r.verdict : undefined;

  if (!compared.length && !trace.length && !rule && !verdict && !linkedRecords.length) {
    return undefined;
  }

  const out: IssueEvidence = {};
  if (compared.length)      out.compared      = compared;
  if (verdict)              out.verdict        = verdict;
  if (rule)                 out.rule           = rule;
  if (trace.length)         out.trace          = trace;
  if (linkedRecords.length) out.linkedRecords  = linkedRecords;
  return out;
}

// ─── Parsing ──────────────────────────────────────────────────────────────────
interface ParsedDoc {
  fileName: string;
  score: number;
  summary: string;
  issues: Array<Omit<Issue, "id">>;
  // metadata is now embedded inside each document (not a separate top-level array)
  metadata?: unknown;
}

interface ParsedReview {
  documents: ParsedDoc[];
  overallScore?: number;
  // Legacy: some responses may still have top-level metadata array — kept as fallback
  metadata?: unknown[];
}

const SEVERITIES: IssueSeverity[] = ["error", "warning", "suggestion"];

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Extract a ReportMetadata from a raw object, tolerating missing / null fields */
function extractMetadata(raw: unknown): ReportMetadata {
  const metadataKeys: (keyof ReportMetadata)[] = [
    "reportNo", "ulr", "customer", "sample", "sampleId", "issuedDate",
    "samplingDate", "receiptDate", "analysisStartDate", "analysisEndDate",
    "subLabs", "documentClass", "nabl", "method", "matrix", "version",
  ];
  const entry = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as ReportMetadata;
  for (const k of metadataKeys) {
    out[k] = typeof entry[k] === "string" ? (entry[k] as string) : null;
  }
  return out;
}

export function parseReviewToResult(
  raw: string,
  uploaded: { id: string; name: string }[],
): { result: ReviewResult; metadata: ReportMetadata[] } {
  const parsed = tryParseJson<ParsedReview>(raw);
  const docs = Array.isArray(parsed.documents) ? parsed.documents : [];

  // Legacy fallback: top-level metadata array (old schema)
  const legacyMeta = Array.isArray(parsed.metadata) ? parsed.metadata : [];

  const documents = uploaded.map((u, idx) => {
    const match =
      docs.find((d) => d.fileName?.trim() === u.name.trim()) ?? docs[idx];
    const score = clampScore(match?.score);

    const issues = (Array.isArray(match?.issues) ? match!.issues : [])
      .filter(
        (i): i is Omit<Issue, "id"> =>
          !!i &&
          typeof i.title === "string" &&
          SEVERITIES.includes(i.severity as IssueSeverity),
      )
      .map((i, k) => ({
        id: `${u.id}-issue-${k}`,
        severity: i.severity as IssueSeverity,
        // headCode: safely coerce — falls back to undefined if invalid
        headCode: isHeadCode((i as { headCode?: unknown }).headCode)
          ? (i as { headCode: HeadCode }).headCode
          : undefined,
        title: i.title,
        description: i.description ?? "",
        location: i.location ?? "",
        suggestion: i.suggestion ?? "",
        page: typeof i.page === "number" ? i.page : undefined,
        evidence: sanitiseEvidence((i as { evidence?: unknown }).evidence),
      })) satisfies Issue[];

    return {
      fileId: u.id,
      fileName: u.name,
      score,
      summary: match?.summary ?? "",
      issues,
    };
  });

  const overallScore =
    typeof parsed.overallScore === "number"
      ? clampScore(parsed.overallScore)
      : Math.round(
          documents.reduce((s, d) => s + d.score, 0) /
            Math.max(1, documents.length),
        );

  // Extract per-document metadata.
  // NEW schema: metadata is embedded inside each documents[] entry as doc.metadata.
  // LEGACY fallback: if doc.metadata is absent, try the old top-level metadata[] array by index.
  const metadata: ReportMetadata[] = uploaded.map((u, idx) => {
    const match =
      docs.find((d) => d.fileName?.trim() === u.name.trim()) ?? docs[idx];

    // Prefer inline metadata (new schema)
    if (match?.metadata && typeof match.metadata === "object") {
      return extractMetadata(match.metadata);
    }

    // Fallback: old top-level metadata array — try name match then index
    const legacyByName = legacyMeta.find(
      (m) => m && typeof (m as Record<string, unknown>).fileName === "string"
        && ((m as Record<string, unknown>).fileName as string).trim() === u.name.trim()
    );
    return extractMetadata(legacyByName ?? legacyMeta[idx]);
  });

  return {
    result: {
      documents,
      overallScore,
      reviewedAt: new Date().toISOString(),
    },
    metadata,
  };
}

// ─── Public entry point ───────────────────────────────────────────────────────
export async function runPdfReview(
  uploaded: { id: string; name: string; file: File }[],
  signal?: AbortSignal,
): Promise<{ result: ReviewResult; correlationId: string; model: string; metadata: ReportMetadata[] }> {
  const correlationId = newCorrelationId();

  // Single call — review findings + report metadata extracted together in one PDF read
  const success = await reviewPdfs(
    {
      files: uploaded.map((u) => u.file),
      prompt: STRUCTURED_PROMPT,
      correlationId,
      deleteFilesAfter: true,
    },
    signal,
  );

  const { result, metadata } = parseReviewToResult(
    success.review,
    uploaded.map((u) => ({ id: u.id, name: u.name })),
  );

  return { result, correlationId: success.correlationId, model: success.model, metadata };
}