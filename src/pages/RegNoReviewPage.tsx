import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  FileText,
  XCircle,
  AlertTriangle,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  RefreshCw,
  BookOpen,
  Download,
  Pencil,
  X,
  RotateCcw,
  Database,
  Save,
  Loader2,
  ShieldCheck,
  ShieldX,
  Clock,
  ScrollText,
  User,
  ChevronRight,
} from "lucide-react";
import type { IssueSeverity } from "../types/DocumentReview";
import type { Issue } from "../types/Issue";
import { HEADS, type HeadCode } from "../types/Head";
import { exportReviewToPdf } from "../utils/exportReviewPdf";
import {
  extractTargetRows,
  updateRegNoResults,
  type IssueTargetRow,
  type FieldEdit,
  TARGET_FIELD_LABEL,
  type RegNoReviewBundle,
} from "../services/regNoReviewClient";
import {
  getApproval,
  setApproval,
  getAuditLogs,
  statusMeta,
  type CoaApprovalRecord,
  type ApprovalStatus,
  type AuditLogEntry,
} from "../services/approvalClient";
import type { LimsRow } from "../types/RegNoReview";

// ─────────────────────────────────────────────────────────────────────────────
// Constants & tiny helpers
// ─────────────────────────────────────────────────────────────────────────────

type IssueAction = "pending" | "modified" | "ignored";

const issuesPercent = (s: number) => Math.max(0, Math.min(100, 100 - s));

const SEVERITY_META: Record<IssueSeverity, {
  Icon: React.ElementType; iconClass: string; badge: string; leftBorder: string;
}> = {
  error:      { Icon: XCircle,       iconClass: "text-red-500",   badge: "bg-red-100 text-red-700 border border-red-200",     leftBorder: "border-l-red-500"   },
  warning:    { Icon: AlertTriangle, iconClass: "text-amber-500", badge: "bg-amber-100 text-amber-700 border border-amber-200", leftBorder: "border-l-amber-400" },
  suggestion: { Icon: Lightbulb,     iconClass: "text-blue-500",  badge: "bg-blue-100 text-blue-700 border border-blue-200",   leftBorder: "border-l-blue-400"  },
};

const ACTION_META: Record<IssueAction, { label: string; bg: string; text: string; border: string }> = {
  pending:  { label: "Pending",  bg: "bg-slate-100", text: "text-slate-500",  border: "border-slate-200" },
  modified: { label: "Modified", bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200"   },
  ignored:  { label: "Ignored",  bg: "bg-slate-50",  text: "text-slate-500",  border: "border-slate-300"  },
};

/**
 * When an issue targets more rows than this threshold we switch to "bulk edit"
 * mode: a single input whose value is applied to every affected row at once.
 */
const BULK_THRESHOLD = 5;

function rowKey(groupCode: string, parameter: string) {
  return `${groupCode.trim().toUpperCase()}::${parameter.trim().toLowerCase()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// IssueCard — unchanged logic; inline modify editor
// ─────────────────────────────────────────────────────────────────────────────

interface IssueCardProps {
  issue: Issue;
  index: number;
  action: IssueAction;
  onAction: (action: IssueAction) => void;
  rowsLookup: Map<string, LimsRow>;
  onSaveEdits: (edits: FieldEdit[]) => Promise<void>;
  /** All LIMS rows for this reg-no — used to build bulk targetRows when the AI
   *  emits no targetRows but the issue clearly affects every parameter. */
  allRows: LimsRow[];
}

function IssueCard({ issue, index, action, onAction, rowsLookup, onSaveEdits, allRows }: IssueCardProps) {
  const [open, setOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Confirm-modify dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingEdits, setPendingEdits] = useState<Array<{ label: string; current: string; next: string }>>([]);

  // Bulk mode state — single value applied to all rows
  const [bulkValue, setBulkValue] = useState("");
  const [bulkPreviewOpen, setBulkPreviewOpen] = useState(false);

  const m = SEVERITY_META[issue.severity];
  const Icon = m.Icon;
  const isBlock = issue.severity === "error";
  const am = ACTION_META[action];

  const targetRowsRaw: IssueTargetRow[] = useMemo(() => extractTargetRows(issue), [issue]);

  // If the AI returned no targetRows but the issue clearly spans all/most
  // parameters (e.g. "all methods are N/A"), build targetRows from every
  // row in allRows using the derived fieldName.
  const targetRows: IssueTargetRow[] = useMemo(() => {
    if (targetRowsRaw.length > 0) return targetRowsRaw;

    // Heuristic: title/description mentions "all" or "every" and allRows exist
    const text = `${issue.title} ${issue.description ?? ""}`.toLowerCase();
    const isAllRowsIssue =
      (text.includes("all ") || text.includes("every ") || text.includes("across every")) &&
      allRows.length > 0;

    if (!isAllRowsIssue) return targetRowsRaw;

    // Derive the field from rule/headCode/evidence like extractTargetRows does
    const ev = issue.evidence as (Issue["evidence"] & { targetRows?: unknown }) | undefined;
    const compared = ev?.compared ?? [];
    const ruleCode = ev?.rule?.code;
    const headCode = issue.headCode;
    // Import deriveFieldName indirectly via the same logic used in extractTargetRows:
    // We re-use extractTargetRows with a synthetic issue carrying one dummy targetRow
    // to get the resolved fieldName, then broadcast it.
    // Simpler: just call extractTargetRows on the issue to get fieldName, and replicate
    // across all rows if it returned 0. We'll do it by checking rule/evidence ourselves.
    const fieldName = (() => {
      const rc = (ruleCode ?? "").toUpperCase();
      const hc = (headCode ?? "").toUpperCase();
      for (const c of compared) {
        const lab = c.label.toLowerCase().replace(/[\s_-]/g, "");
        if (lab === "uom" || lab === "unit" || lab === "unitofmeasure") return "uom" as const;
        if (lab === "loq")                                               return "loq" as const;
        if (lab === "method")                                            return "method" as const;
        if (lab === "requirements" || lab === "spec" || lab === "specification") return "requirements" as const;
      }
      if (rc.includes("UOM") || rc.includes("UNIT"))  return "uom" as const;
      if (rc.includes("LOQ"))                          return "loq" as const;
      if (rc.includes("REG") || rc.includes("METHOD")) return "method" as const;
      if (rc.includes("SPEC") || rc.includes("REQ"))  return "requirements" as const;
      if (hc === "REGULATORY")                         return "method" as const;
      if (hc === "HYGIENE")                            return "uom" as const;
      return "results" as const;
    })();

    return allRows
      .filter((r) => r.groupCode && r.parameter)
      .map((r): IssueTargetRow => ({
        groupCode: r.groupCode!,
        parameter: r.parameter!,
        fieldName,
        suggestedValue: undefined,
        suggestedResult: undefined,
      }));
  }, [targetRowsRaw, issue, allRows]);

  /** True when there are too many rows to show individual inputs */
  const isBulk = targetRows.length > BULK_THRESHOLD;

  const resolvedBorder =
    action === "modified" ? "border-l-blue-500"  :
    action === "ignored"  ? "border-l-slate-300"  :
    m.leftBorder;

  // drafts keyed as "groupCode::parameter::fieldName"
  const draftKey = (t: IssueTargetRow) => `${rowKey(t.groupCode, t.parameter)}::${t.fieldName}`;

  const openEditor = useCallback(() => {
    if (isBulk) {
      // Bulk mode: pre-fill with the first suggestion found, or empty
      const firstSuggestion = targetRows.find((t) => t.suggestedValue)?.suggestedValue ?? "";
      setBulkValue(firstSuggestion);
      setEditorOpen(true);
      setSaveError(null);
      return;
    }
    const seed: Record<string, string> = {};
    for (const t of targetRows) {
      const k = draftKey(t);
      const row = rowsLookup.get(rowKey(t.groupCode, t.parameter));
      // Pre-fill with AI suggestion → current row value → empty
      seed[k] = t.suggestedValue ?? (row ? (row[t.fieldName as keyof typeof row] as string | undefined) ?? "" : "");
    }
    setDrafts(seed);
    setEditorOpen(true);
    setSaveError(null);
  }, [targetRows, rowsLookup, isBulk]);

  const handleModifyClick = () => {
    // "Modify Again" — reopen editor (don't undo)
    if (action === "modified") { setOpen(true); openEditor(); return; }
    if (targetRows.length === 0) { onAction("modified"); return; }
    setOpen(true);
    openEditor();
  };

  // Build preview list for confirm dialog, then open it
  const handleReviewAndConfirm = () => {
    if (isBulk) {
      const value = bulkValue.trim();
      if (!value) { setSaveError("Please enter a value to apply to all rows."); return; }
      const fieldLabel = TARGET_FIELD_LABEL[targetRows[0]?.fieldName ?? "results"];
      const preview = targetRows.slice(0, 5).map((t) => {
        const row = rowsLookup.get(rowKey(t.groupCode, t.parameter));
        const currentVal = row ? (row[t.fieldName as keyof typeof row] as string | undefined) ?? "—" : "—";
        return { label: `${t.parameter} · ${fieldLabel}`, current: currentVal, next: value };
      });
      // Add a placeholder entry if there are more rows
      if (targetRows.length > 5) {
        preview.push({ label: `… and ${targetRows.length - 5} more rows`, current: "various", next: value });
      }
      setSaveError(null);
      setPendingEdits(preview);
      setConfirmOpen(true);
      return;
    }

    const preview = targetRows
      .map((t) => {
        const k = draftKey(t);
        const value = (drafts[k] ?? "").trim();
        if (!value) return null;
        const row = rowsLookup.get(rowKey(t.groupCode, t.parameter));
        const currentVal = row ? (row[t.fieldName as keyof typeof row] as string | undefined) ?? "—" : "—";
        return { label: `${t.parameter} · ${TARGET_FIELD_LABEL[t.fieldName]}`, current: currentVal, next: value };
      })
      .filter((x): x is { label: string; current: string; next: string } => x !== null);

    if (preview.length === 0) { setSaveError("Please enter at least one corrected value."); return; }
    setSaveError(null);
    setPendingEdits(preview);
    setConfirmOpen(true);
  };

  const submitEdits = async () => {
    setConfirmOpen(false);
    if (targetRows.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      let edits: FieldEdit[];
      if (isBulk) {
        const value = bulkValue.trim();
        if (!value) { setSaveError("Please enter a value to apply to all rows."); setSaving(false); return; }
        edits = targetRows.map((t): FieldEdit => ({
          groupCode: t.groupCode,
          parameter: t.parameter,
          fieldName: t.fieldName,
          value,
        }));
      } else {
        edits = targetRows
          .map((t): FieldEdit | null => {
            const k = draftKey(t);
            const value = (drafts[k] ?? "").trim();
            if (!value) return null;
            return { groupCode: t.groupCode, parameter: t.parameter, fieldName: t.fieldName, value };
          })
          .filter((e): e is FieldEdit => e !== null);
        if (edits.length === 0) { setSaveError("Please enter at least one corrected value."); setSaving(false); return; }
      }
      await onSaveEdits(edits);
      setEditorOpen(false);
      onAction("modified");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-xl border border-l-[3px] ${resolvedBorder} border-slate-200 bg-white overflow-hidden transition-all duration-150 hover:border-slate-300 ${action !== "pending" ? "opacity-90" : ""}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-slate-50/60 transition-colors duration-150"
      >
        <Icon size={16} className={`${action !== "pending" ? "text-slate-300" : m.iconClass} shrink-0 mt-0.5 transition-colors duration-150`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className="text-[10px] font-mono text-slate-400 tabular-nums">#{String(index + 1).padStart(2, "0")}</span>
            {action === "pending" && (
              <span className={`text-[9.5px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ${m.badge}`}>{issue.severity}</span>
            )}
            {issue.headCode && (
              <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-700 bg-slate-100 border border-slate-300 px-1.5 py-0.5 rounded">{issue.headCode}</span>
            )}
            {issue.evidence?.rule?.code && (
              <span className="text-[9.5px] font-mono text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded">{issue.evidence.rule.code}</span>
            )}
            {targetRows.length > 0 && (
              <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                <Pencil size={9} />editable
              </span>
            )}
            {action !== "pending" && (
              <span className={`text-[9.5px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border ${am.bg} ${am.text} ${am.border}`}>{am.label}</span>
            )}
          </div>
          <p className="text-slate-900 font-semibold text-sm leading-snug">{issue.title}</p>
          {issue.location && <p className="text-slate-400 text-[11px] mt-1 truncate">{issue.location}</p>}
        </div>
        <span className="text-slate-300 shrink-0 mt-1">{open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-4 space-y-4 bg-slate-50/40">
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.14em] mb-1.5">Description</p>
            <p className="text-slate-700 text-xs leading-relaxed">{issue.description}</p>
          </div>

          {issue.evidence && (
            <div className="bg-white rounded-lg border border-slate-200 p-3.5 space-y-2.5">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.14em]">What the engine compared</p>
              {issue.evidence.compared && issue.evidence.compared.length > 0 && (
                <div className="font-mono text-[11px] leading-relaxed space-y-1">
                  {issue.evidence.compared.map((c, idx) => (
                    <div key={idx} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="inline-block min-w-[80px] text-slate-500">{c.label}</span>
                      {c.old !== undefined && <span className="text-slate-400 line-through">{c.old}</span>}
                      {c.old !== undefined && c.new !== undefined && <span className="text-slate-300">→</span>}
                      {c.new !== undefined && <span className="text-slate-900 font-semibold">{c.new}</span>}
                    </div>
                  ))}
                </div>
              )}
              {issue.evidence.verdict && (
                <p className="pt-2 border-t border-dashed border-slate-200 text-[11px] font-semibold text-red-600">{issue.evidence.verdict}</p>
              )}
              {issue.evidence.rule && (
                <p className="text-[10px] text-slate-400 font-mono">
                  Rule {issue.evidence.rule.code}{issue.evidence.rule.version ? ` · ${issue.evidence.rule.version}` : ""}
                </p>
              )}
            </div>
          )}

          {issue.suggestion && (
            <div className="bg-white rounded-lg border border-blue-100 border-l-[3px] border-l-blue-500 p-3.5">
              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-[0.14em] mb-1.5 flex items-center gap-1.5">
                <Lightbulb size={10} className="text-blue-500" />What to do
              </p>
              <p className="text-slate-700 text-xs leading-relaxed">{issue.suggestion}</p>
            </div>
          )}

          {issue.location && (
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400"><BookOpen size={10} />{issue.location}</div>
          )}

          {/* Inline modify editor */}
          {editorOpen && targetRows.length > 0 && (
            <div className="bg-white rounded-lg border border-blue-200 border-l-[3px] border-l-blue-500 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold text-blue-600 uppercase tracking-[0.14em] flex items-center gap-1.5">
                  <Pencil size={10} className="text-blue-500" />
                  {isBulk
                    ? `Bulk-correct ${targetRows.length} rows`
                    : `Correct the value${targetRows.length > 1 ? "s" : ""}`}
                </p>
                <button onClick={() => setEditorOpen(false)} disabled={saving} className="text-[10px] text-slate-400 hover:text-slate-700 transition-colors disabled:opacity-40">Cancel</button>
              </div>

              {/* ── BULK MODE ── */}
              {isBulk ? (() => {
                const fieldName = targetRows[0]?.fieldName ?? "results";
                const fieldLabel = TARGET_FIELD_LABEL[fieldName];
                const sampleRows = targetRows.slice(0, bulkPreviewOpen ? targetRows.length : 4);
                return (
                  <div className="space-y-3">
                    {/* Info banner */}
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                      <AlertTriangle size={11} className="text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-amber-700 leading-relaxed">
                        This issue affects <strong>{targetRows.length} rows</strong>. The value you enter will be applied to the <strong>{fieldLabel}</strong> field of every affected row at once.
                      </p>
                    </div>

                    {/* Single input */}
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border ${
                          fieldName === "results"      ? "bg-blue-50 text-blue-700 border-blue-200"   :
                          fieldName === "uom"          ? "bg-purple-50 text-purple-700 border-purple-200" :
                          fieldName === "loq"          ? "bg-orange-50 text-orange-700 border-orange-200" :
                          fieldName === "method"       ? "bg-teal-50 text-teal-700 border-teal-200"   :
                                                         "bg-slate-100 text-slate-600 border-slate-200"
                        }`}>
                          {fieldLabel}
                        </span>
                        <span className="text-[10px] text-slate-400">applied to all {targetRows.length} rows</span>
                      </div>
                      <label className="flex items-center gap-2 text-[10px] text-slate-500">
                        <span className="w-20 shrink-0 font-semibold">New {fieldLabel}</span>
                        <input
                          type="text"
                          value={bulkValue}
                          onChange={(e) => setBulkValue(e.target.value)}
                          placeholder={`Enter corrected ${fieldLabel.toLowerCase()} for all rows`}
                          disabled={saving}
                          autoFocus
                          className="flex-1 px-2 py-1 rounded border border-slate-200 bg-white text-[11px] font-mono text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 disabled:opacity-60"
                        />
                      </label>
                    </div>

                    {/* Affected rows preview */}
                    <div>
                      <button
                        type="button"
                        onClick={() => setBulkPreviewOpen((o) => !o)}
                        className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 hover:text-slate-800 transition-colors mb-1.5"
                      >
                        {bulkPreviewOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        {bulkPreviewOpen ? "Hide" : "Preview"} affected rows
                      </button>
                      {bulkPreviewOpen && (
                        <div className="rounded-md border border-slate-200 overflow-hidden max-h-48 overflow-y-auto">
                          {sampleRows.map((t, i) => {
                            const row = rowsLookup.get(rowKey(t.groupCode, t.parameter));
                            const currentVal = row ? (row[t.fieldName as keyof typeof row] as string | undefined) ?? "—" : "—";
                            return (
                              <div key={i} className={`flex items-center gap-2 px-3 py-1.5 text-[10px] ${i % 2 === 0 ? "bg-white" : "bg-slate-50"} ${i !== 0 ? "border-t border-slate-100" : ""}`}>
                                <span className="font-mono text-slate-400 text-[9px] w-12 shrink-0">{t.groupCode}</span>
                                <span className="flex-1 font-medium text-slate-700 truncate">{t.parameter}</span>
                                <span className="font-mono text-slate-400 line-through text-[9px] shrink-0">{currentVal}</span>
                                <ChevronRight size={9} className="text-slate-300 shrink-0" />
                                <span className="font-mono text-blue-600 font-bold text-[9px] shrink-0">{bulkValue || "…"}</span>
                              </div>
                            );
                          })}
                          {!bulkPreviewOpen && targetRows.length > 4 && (
                            <div className="px-3 py-1.5 text-[10px] text-slate-400 bg-slate-50 border-t border-slate-100 text-center">
                              + {targetRows.length - 4} more rows
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })() : (
              /* ── INDIVIDUAL ROW MODE ── */
              <div className="space-y-2.5">
                {targetRows.map((t) => {
                  const k = draftKey(t);
                  const row = rowsLookup.get(rowKey(t.groupCode, t.parameter));
                  const currentVal = row ? (row[t.fieldName as keyof typeof row] as string | undefined) ?? "—" : "—";
                  const fieldLabel = TARGET_FIELD_LABEL[t.fieldName];
                  return (
                    <div key={k} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-700 bg-white border border-slate-200 px-1.5 py-0.5 rounded font-mono">{t.groupCode}</span>
                        <span className="text-[11px] font-semibold text-slate-800">{t.parameter}</span>
                        {/* show all sibling groupCodes if multiple rows share same parameter */}
                        {row?.uom && t.fieldName !== "uom" && <span className="text-[10px] text-slate-400 font-mono">({row.uom})</span>}
                        <span className={`text-[9px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border ${
                          t.fieldName === "results"      ? "bg-blue-50 text-blue-700 border-blue-200"   :
                          t.fieldName === "uom"          ? "bg-purple-50 text-purple-700 border-purple-200" :
                          t.fieldName === "loq"          ? "bg-orange-50 text-orange-700 border-orange-200" :
                          t.fieldName === "method"       ? "bg-teal-50 text-teal-700 border-teal-200"   :
                                                           "bg-slate-100 text-slate-600 border-slate-200"
                        }`}>
                          {fieldLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="text-slate-400 w-16 shrink-0">Current</span>
                        <span className="font-mono text-slate-700">{currentVal}</span>
                      </div>
                      {row?.requirements && t.fieldName !== "requirements" && (
                        <div className="flex items-center gap-2 text-[10px]">
                          <span className="text-slate-400 w-16 shrink-0">Spec</span>
                          <span className="font-mono text-slate-700">{row.requirements}</span>
                        </div>
                      )}
                      <label className="flex items-center gap-2 text-[10px] text-slate-500">
                        <span className="w-16 shrink-0 font-semibold">New {fieldLabel}</span>
                        <input
                          type="text"
                          value={drafts[k] ?? ""}
                          onChange={(e) => setDrafts((p) => ({ ...p, [k]: e.target.value }))}
                          placeholder={t.suggestedValue ?? `Enter corrected ${fieldLabel.toLowerCase()}`}
                          disabled={saving}
                          className="flex-1 px-2 py-1 rounded border border-slate-200 bg-white text-[11px] font-mono text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 disabled:opacity-60"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
              )}

              {saveError && <p className="text-[11px] text-red-600">{saveError}</p>}

              <div className="flex items-center gap-2">
                <button
                  onClick={handleReviewAndConfirm}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white border border-blue-600 transition-all disabled:opacity-60"
                >
                  {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  {saving ? "Saving…" : (isBulk ? `Review & Apply to ${targetRows.length} rows` : "Review & Save")}
                </button>
                <p className="text-[10px] text-slate-400">Saves <code className="font-mono text-slate-500">PUT /api/find/update</code></p>
              </div>
            </div>
          )}

          {/* Confirm-changes dialog */}
          {confirmOpen && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setConfirmOpen(false)} />
              <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden">
                {/* Dialog header */}
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                    <Save size={14} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Confirm changes</p>
                    <p className="text-[10px] text-slate-400">
                      {isBulk
                        ? `Applying to ${targetRows.length} rows — review before saving`
                        : "Review before saving to LIMS"}
                    </p>
                  </div>
                  <button onClick={() => setConfirmOpen(false)} className="ml-auto text-slate-300 hover:text-slate-600 transition-colors">
                    <X size={15} />
                  </button>
                </div>

                {/* Changes preview */}
                <div className="px-5 py-4 space-y-2.5 max-h-64 overflow-y-auto">
                  {pendingEdits.map((e, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.1em] mb-2">{e.label}</p>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-0.5">Current</p>
                          <p className="text-[11px] font-mono text-slate-500 line-through truncate">{e.current}</p>
                        </div>
                        <ChevronRight size={12} className="text-slate-300 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[9px] font-semibold text-blue-500 uppercase tracking-[0.08em] mb-0.5">New</p>
                          <p className="text-[11px] font-mono font-bold text-blue-700 truncate">{e.next}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Dialog actions */}
                <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
                  <button
                    onClick={submitEdits}
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-bold bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-60"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    {saving ? "Saving…" : "Confirm & Save"}
                  </button>
                  <button
                    onClick={() => setConfirmOpen(false)}
                    className="px-4 py-2.5 rounded-xl text-[12px] font-semibold text-slate-600 border border-slate-200 hover:border-slate-400 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="pt-1 border-t border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.14em] mb-2">How do you want to handle this?</p>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleModifyClick}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all duration-150 ${action === "modified" ? "bg-blue-50 text-blue-700 border-blue-300 hover:bg-blue-100 hover:border-blue-500" : "bg-white text-blue-700 border-blue-300 hover:bg-blue-50 hover:border-blue-500"}`}
              >
                <Pencil size={11} />{action === "modified" ? "Modify Again" : "Modify"}
              </button>
              <button
                onClick={() => onAction(action === "ignored" ? "pending" : "ignored")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all duration-150 ${action === "ignored" ? "bg-slate-600 text-white border-slate-600" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50 hover:border-slate-500"}`}
              >
                <X size={11} />{action === "ignored" ? "Unignore" : "Ignore"}
              </button>
              {action !== "pending" && (
                <button
                  onClick={() => { onAction("pending"); setEditorOpen(false); }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-slate-400 border border-slate-200 hover:text-slate-600 hover:border-slate-400 transition-all duration-150 ml-auto"
                  title="Reset to pending"
                >
                  <RotateCcw size={10} />Reset
                </button>
              )}
            </div>
            {isBlock && action === "pending" && (
              <p className="mt-2 text-[10px] text-red-500 leading-relaxed">⛔ This is a blocking error — it must be <strong>Modified</strong> or <strong>Ignored</strong> before the report can be approved.</p>
            )}
            {issue.severity === "warning" && action === "pending" && (
              <p className="mt-2 text-[10px] text-amber-600 leading-relaxed">⚠ This warning needs a decision — modify the report or ignore it to proceed.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


interface ApprovalPanelProps {
  regNo: string;
  canApprove: boolean;
  unresolvedBlocks: number;
  pendingCount: number;
  record: CoaApprovalRecord | null;
  submitting: boolean;
  onApprove: (notes?: string) => void;
  onReject:  (notes?: string) => void;
}

function ApprovalPanel({
  canApprove, unresolvedBlocks, pendingCount,
  record, submitting, onApprove, onReject,
}: ApprovalPanelProps) {
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  const [notes, setNotes] = useState("");
  const prevSubmitting = useRef(submitting);

  const currentStatus = record?.status as ApprovalStatus | undefined;
  const sm = statusMeta(currentStatus);
  const isApproveDialog = dialog === "approve";

  const openDialog = (type: "approve" | "reject") => { setNotes(""); setDialog(type); };
  const closeDialog = () => { if (submitting) return; setDialog(null); setNotes(""); };
  const handleConfirm = () => {
    if (isApproveDialog) onApprove(notes.trim() || undefined);
    else onReject(notes.trim() || undefined);
  };

  // Auto-close dialog when submission completes
  useEffect(() => {
    if (prevSubmitting.current && !submitting) { setDialog(null); setNotes(""); }
    prevSubmitting.current = submitting;
  }, [submitting]);

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-slate-100 flex items-center justify-center">
            <ShieldCheck size={11} className="text-slate-500" />
          </div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.16em]">Report Decision</p>
        </div>

        <div className="p-4 space-y-3">
          {/* Current status badge */}
          {record && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${sm.bgClass} ${sm.borderClass}`}>
              {currentStatus === "Approved" && <ShieldCheck size={13} className={sm.colorClass} />}
              {currentStatus === "Rejected" && <ShieldX    size={13} className={sm.colorClass} />}
              {currentStatus === "Pending"  && <Clock      size={13} className={sm.colorClass} />}
              <div className="flex-1 min-w-0">
                <p className={`text-[11px] font-bold ${sm.colorClass}`}>{sm.label}</p>
                {record.reviewedBy && (
                  <p className="text-[10px] text-slate-500 truncate">by {record.reviewedBy}</p>
                )}
              </div>
            </div>
          )}

          {/* Readiness info */}
          {unresolvedBlocks > 0 ? (
            <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
              <XCircle size={12} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-700 leading-relaxed">
                <strong>{unresolvedBlocks} blocking error{unresolvedBlocks !== 1 ? "s" : ""}</strong> must be resolved before approving.
              </p>
            </div>
          ) : pendingCount > 0 ? (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
              <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 leading-relaxed">
                <strong>{pendingCount} finding{pendingCount !== 1 ? "s" : ""}</strong> still pending — action all before approving.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
              <CheckCircle2 size={12} className="text-green-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-green-700 leading-relaxed">All findings actioned — ready to approve.</p>
            </div>
          )}

          {/* Approve button — hidden once already approved */}
          {currentStatus !== "Approved" && (
            <button
              onClick={() => openDialog("approve")}
              disabled={!canApprove || submitting}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-bold border transition-all ${
                canApprove && !submitting
                  ? "bg-green-600 hover:bg-green-700 text-white border-green-600"
                  : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
              }`}
            >
              <ShieldCheck size={13} />Approve Report
            </button>
          )}

          {/* Reject button — hidden once already rejected */}
          {currentStatus !== "Rejected" && (
            <button
              onClick={() => openDialog("reject")}
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-bold border border-red-200 text-red-700 bg-white hover:bg-red-50 transition-all disabled:opacity-50"
            >
              <ShieldX size={13} />Reject Report
            </button>
          )}
        </div>
      </div>

      {/* ── Approve / Reject confirmation dialog ── */}
      {dialog !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closeDialog} />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-sm overflow-hidden">

            {/* Dialog header */}
            <div className={`px-5 py-4 border-b border-slate-100 flex items-center gap-3 ${isApproveDialog ? "bg-green-50/60" : "bg-red-50/60"}`}>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isApproveDialog ? "bg-green-100 border border-green-200" : "bg-red-100 border border-red-200"}`}>
                {isApproveDialog
                  ? <ShieldCheck size={16} className="text-green-600" />
                  : <ShieldX     size={16} className="text-red-600" />}
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">
                  {isApproveDialog ? "Approve Report" : "Reject Report"}
                </p>
                <p className="text-[10px] text-slate-400">
                  {isApproveDialog ? "This will mark the report as approved." : "This will mark the report as rejected."}
                </p>
              </div>
              <button
                onClick={closeDialog}
                disabled={submitting}
                className="ml-auto text-slate-300 hover:text-slate-600 transition-colors disabled:opacity-40"
              >
                <X size={15} />
              </button>
            </div>

            {/* Notes textarea */}
            <div className="px-5 py-4 space-y-2">
              <p className={`text-[10px] font-bold uppercase tracking-[0.12em] ${isApproveDialog ? "text-green-700" : "text-red-700"}`}>
                {isApproveDialog ? "Approval note" : "Reason for rejection"}
                <span className="text-slate-400 font-normal ml-1">(optional)</span>
              </p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={isApproveDialog
                  ? "e.g. All parameters within specification…"
                  : "e.g. Assay result out of specification — re-analysis required…"}
                rows={3}
                disabled={submitting}
                autoFocus
                className={`w-full px-2.5 py-2 rounded-lg border bg-white text-[11px] text-slate-800 placeholder:text-slate-300 focus:outline-none resize-none disabled:opacity-60 transition-colors ${
                  isApproveDialog
                    ? "border-green-200 focus:border-green-500 focus:ring-1 focus:ring-green-100"
                    : "border-red-200 focus:border-red-500 focus:ring-1 focus:ring-red-100"
                }`}
              />
            </div>

            {/* Dialog actions */}
            <div className="px-5 pb-5 flex gap-2">
              <button
                onClick={handleConfirm}
                disabled={submitting}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-bold text-white transition-colors disabled:opacity-70 ${
                  isApproveDialog ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
                }`}
              >
                {submitting
                  ? <><Loader2 size={13} className="animate-spin" />Processing…</>
                  : isApproveDialog
                    ? <><ShieldCheck size={13} />Confirm Approve</>
                    : <><ShieldX     size={13} />Confirm Reject</>}
              </button>
              <button
                onClick={closeDialog}
                disabled={submitting}
                className="px-4 py-2.5 rounded-xl text-[12px] font-semibold text-slate-600 border border-slate-200 hover:border-slate-400 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AuditLogDrawer
// ─────────────────────────────────────────────────────────────────────────────

interface AuditLogDrawerProps {
  regNo: string;
  onClose: () => void;
}

function buildAuditMessage(log: AuditLogEntry): string {
  const field  = log.fieldName ?? "field";
  const oldVal = log.oldValue  ?? null;
  const newVal = log.newValue  ?? null;

  if (log.actionType === "StatusChange") {
    if (oldVal && newVal) return `Status changed from ${oldVal} to ${newVal}`;
    if (newVal)           return `Status set to ${newVal}`;
    return "Status updated";
  }
  if (log.actionType === "HeaderUpdate") {
    if (oldVal && newVal) return `${field} changed from "${oldVal}" to "${newVal}"`;
    if (newVal)           return `${field} set to "${newVal}"`;
    return `${field} updated`;
  }
  // DetailUpdate
  if (oldVal && newVal) return `${field} changed from "${oldVal}" to "${newVal}"`;
  if (newVal)           return `${field} set to "${newVal}"`;
  if (oldVal)           return `${field} cleared (was "${oldVal}")`;
  return `${field} updated`;
}

const AUDIT_LEFT: Record<string, string> = {
  DetailUpdate: "border-l-blue-400",
  HeaderUpdate: "border-l-violet-400",
  StatusChange: "border-l-amber-400",
};

const AUDIT_BADGE: Record<string, string> = {
  DetailUpdate: "text-blue-600 bg-blue-50",
  HeaderUpdate: "text-violet-600 bg-violet-50",
  StatusChange: "text-amber-600 bg-amber-50",
};

const AUDIT_LABEL: Record<string, string> = {
  DetailUpdate: "Field Edit",
  HeaderUpdate: "Header",
  StatusChange: "Status",
};

function AuditLogDrawer({ regNo, onClose }: AuditLogDrawerProps) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAuditLogs(regNo)
      .then((data) => {
        if (cancelled) return;
        if (!data) { setLogs([]); return; }
        if (Array.isArray(data)) { setLogs(data); return; }
        const obj = data as Record<string, unknown>;
        const u = obj["data"] ?? obj["logs"] ?? obj["auditLogs"] ?? obj["items"] ?? obj["results"];
        setLogs(Array.isArray(u) ? (u as AuditLogEntry[]) : []);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [regNo]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      <div className="relative w-full max-w-sm bg-white shadow-2xl flex flex-col h-full border-l border-slate-200">

        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3.5 border-b border-slate-100">
          <div>
            <p className="text-[13px] font-bold text-slate-900 leading-none">Audit Trail</p>
            <p className="text-[10px] text-slate-400 font-mono mt-1 leading-none">{regNo}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">

          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-[12px]">Loading…</span>
            </div>
          )}

          {error && (
            <div className="m-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
              <AlertTriangle size={12} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-700">{error}</p>
            </div>
          )}

          {!loading && !error && logs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <ScrollText size={20} className="text-slate-300 mb-2" />
              <p className="text-[12px] text-slate-500 font-medium">No audit entries yet</p>
            </div>
          )}

          {!loading && !error && logs.length > 0 && (
            <div className="px-4 py-5">
              <div className="relative">
                {/* Track line */}
                <div className="absolute left-[5px] top-2 bottom-2 w-px bg-slate-200" />

                <div className="space-y-3">
                  {logs.map((log, idx) => {
                    const badge   = AUDIT_BADGE[log.actionType] ?? "text-slate-500 bg-slate-100";
                    const label   = AUDIT_LABEL[log.actionType] ?? log.actionType;
                    const message = buildAuditMessage(log);
                    const context = [log.groupCode, log.parameter].filter(Boolean).join(" / ");
                    const dotColor =
                      log.actionType === "DetailUpdate" ? "bg-blue-600 ring-blue-100" :
                      log.actionType === "HeaderUpdate" ? "bg-violet-600 ring-violet-100" :
                      log.actionType === "StatusChange" ? "bg-amber-600 ring-amber-100" :
                      "bg-slate-400 ring-slate-100";

                    return (
                      <div key={log.id} className="relative flex items-start gap-3">
                        {/* Checkpoint dot */}
                        <div className={`relative z-10 mt-3 w-[10px] h-[10px] rounded-full ring-[2px] shrink-0 ${dotColor}`} />

                        {/* Card */}
                        <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 hover:border-slate-300 hover:shadow-sm transition-all">
                          {/* Badge + message */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0 ${badge}`}>
                              {label}
                            </span>
                            <span className="text-[12px] font-semibold text-slate-800 leading-snug">{message}</span>
                          </div>
                          {/* Meta row */}
                          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-400 flex-wrap">
                            {context && <span className="font-mono text-slate-500 text-[10px]">{context}</span>}
                            {context && <span className="text-slate-300">·</span>}
                            <User size={9} className="shrink-0" />
                            <span>{log.changedBy ?? "—"}</span>
                            <span className="text-slate-300">·</span>
                            <span className="tabular-nums">
                              {new Date(log.changedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// SidebarSection — terminal-style collapsible
// ─────────────────────────────────────────────────────────────────────────────

function SidebarSection({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-slate-100 mt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50 transition-colors group"
      >
        <span className={`text-[9px] font-mono transition-transform duration-200 ${open ? "text-blue-500" : "text-slate-400 -rotate-90"}`}>▼</span>
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 group-hover:text-slate-600 transition-colors font-mono flex-1 text-left">{title}</span>
      </button>
      {open && (
        <div className="pb-2.5 px-3 animate-in fade-in slide-in-from-top-1 duration-150">
          {children}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

const PANEL_MIN     = 320;
const PANEL_MAX     = 720;
const PANEL_DEFAULT = 420;
const PANEL_STORAGE_KEY = "docreview.aiPanelWidth";

// The reviewer name to stamp on audit log entries.
// In a real app this would come from your auth context / session.
const REVIEWER_NAME =
  typeof window !== "undefined"
    ? window.localStorage.getItem("lims.reviewerName") ?? "Reviewer"
    : "Reviewer";

interface Props {
  bundle: RegNoReviewBundle;
  onBack: () => void;
}

export default function RegNoReviewPage({ bundle, onBack }: Props) {
  const { result, metadata, correlationId, model, regNo, header } = bundle;
  const [rows, setRows] = useState<LimsRow[]>(bundle.rows);

  const clientName = bundle.rows[0]?.issuedToClientName ?? null;

  const [filter, setFilter]         = useState<"all" | IssueAction | IssueSeverity>("all");
  const [headFilter, setHeadFilter] = useState<"all" | HeadCode>("all");
  const [issueActions, setIssueActions] = useState<Record<string, IssueAction>>({});

  // Approval state
  const [approvalRecord, setApprovalRecord]   = useState<CoaApprovalRecord | null>(null);
  const [approvalLoading, setApprovalLoading] = useState(true);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [approvalError, setApprovalError]     = useState<string | null>(null);

  // Audit log drawer
  const [auditOpen, setAuditOpen] = useState(false);

  // Fetch existing approval record on mount
  useEffect(() => {
    let cancelled = false;
    setApprovalLoading(true);
    getApproval(regNo)
      .then((r) => { if (!cancelled) setApprovalRecord(r); })
      .catch(() => { /* non-fatal */ })
      .finally(() => { if (!cancelled) setApprovalLoading(false); });
    return () => { cancelled = true; };
  }, [regNo]);

  // Panel resize
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (typeof window === "undefined") return PANEL_DEFAULT;
    const stored = Number(window.localStorage.getItem(PANEL_STORAGE_KEY));
    if (Number.isFinite(stored) && stored >= PANEL_MIN && stored <= PANEL_MAX) return stored;
    return PANEL_DEFAULT;
  });
  const [resizing, setResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.localStorage.setItem(PANEL_STORAGE_KEY, String(panelWidth));
  }, [panelWidth]);

  const startResize = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setResizing(true);
    const getX = (ev: MouseEvent | TouchEvent) => "touches" in ev ? ev.touches[0]?.clientX ?? 0 : ev.clientX;
    const onMove = (ev: MouseEvent | TouchEvent) => {
      const right = containerRef.current?.getBoundingClientRect().right ?? window.innerWidth;
      setPanelWidth(Math.max(PANEL_MIN, Math.min(PANEL_MAX, right - getX(ev))));
    };
    const onEnd = () => {
      setResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onHandleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft")       { e.preventDefault(); setPanelWidth((w) => Math.min(PANEL_MAX, w + 24)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setPanelWidth((w) => Math.max(PANEL_MIN, w - 24)); }
    else if (e.key === "Home")       { e.preventDefault(); setPanelWidth(PANEL_DEFAULT); }
  }, []);

  // Single-doc result
  const doc     = result.documents[0];
  const docMeta = metadata?.[0];

  const errors      = doc?.issues.filter((i) => i.severity === "error"      && (issueActions[i.id] ?? "pending") === "pending") ?? [];
  const warnings    = doc?.issues.filter((i) => i.severity === "warning"    && (issueActions[i.id] ?? "pending") === "pending") ?? [];
  const suggestions = doc?.issues.filter((i) => i.severity === "suggestion" && (issueActions[i.id] ?? "pending") === "pending") ?? [];

  const pendingCount  = doc?.issues.filter((i) => (issueActions[i.id] ?? "pending") === "pending").length ?? 0;
  const modifiedCount = doc?.issues.filter((i) => issueActions[i.id] === "modified").length ?? 0;
  const ignoredCount  = doc?.issues.filter((i) => issueActions[i.id] === "ignored").length ?? 0;

  const unresolvedBlocks = errors.filter((i) => (issueActions[i.id] ?? "pending") === "pending").length;
  const canApprove       = unresolvedBlocks === 0 && pendingCount === 0 && !!doc;

  const getAction = (id: string): IssueAction => issueActions[id] ?? "pending";
  const setAction = (id: string, action: IssueAction) => setIssueActions((prev) => ({ ...prev, [id]: action }));

  const headCounts = HEADS.map((h) => ({
    head: h,
    count:  doc?.issues.filter((i) => i.headCode === h.code && (issueActions[i.id] ?? "pending") === "pending").length ?? 0,
    errors: doc?.issues.filter((i) => i.headCode === h.code && i.severity === "error" && (issueActions[i.id] ?? "pending") === "pending").length ?? 0,
  }));
  const uncategorisedCount = doc?.issues.filter((i) => !i.headCode && (issueActions[i.id] ?? "pending") === "pending").length ?? 0;

  const filtered = (doc?.issues ?? []).filter((i) => {
    if (headFilter !== "all" && i.headCode !== headFilter) return false;
    if (filter === "all")        return true;
    if (filter === "error")      return i.severity === "error";
    if (filter === "warning")    return i.severity === "warning";
    if (filter === "suggestion") return i.severity === "suggestion";
    if (filter === "pending")    return getAction(i.id) === "pending";
    if (filter === "modified")   return getAction(i.id) === "modified";
    if (filter === "ignored")    return getAction(i.id) === "ignored";
    return true;
  });

  const rowsLookup = useMemo(() => {
    const m = new Map<string, LimsRow>();
    for (const r of rows) {
      // Key on the raw groupCode (Trn2groupcd / CODECD) so that the lookup
      // matches what extractTargetRows returns from the AI (which now emits
      // the raw code, not the human-readable groupName).
      if (r.groupCode && r.parameter) {
        m.set(rowKey(r.groupCode, r.parameter), r);
      }
      // Also index by groupName as a fallback so existing data that only has
      // groupName still resolves (e.g. when groupCode is missing from older rows).
      if (r.groupName && r.parameter) {
        const fallbackKey = rowKey(r.groupName, r.parameter);
        if (!m.has(fallbackKey)) m.set(fallbackKey, r);
      }
    }
    return m;
  }, [rows]);

  const [editedKeys, setEditedKeys] = useState<Set<string>>(new Set());

  const handleSaveEdits = useCallback(
    async (edits: FieldEdit[]) => {
      await updateRegNoResults({ regNo, items: edits, changedBy: REVIEWER_NAME });
      setRows((prev) => {
        const byGroupCode = new Map(
          prev.map((r) => [rowKey(r.groupCode ?? r.groupName!, r.parameter!), r] as const),
        );
        for (const e of edits) {
          const k = rowKey(e.groupCode, e.parameter);
          const existing = byGroupCode.get(k);
          // Write the value into the exact field that was edited
          if (existing) byGroupCode.set(k, { ...existing, [e.fieldName]: e.value });
        }
        return Array.from(byGroupCode.values());
      });
      setEditedKeys((prev) => {
        const next = new Set(prev);
        for (const e of edits) next.add(rowKey(e.groupCode, e.parameter));
        return next;
      });
    },
    [regNo],
  );

  // ── Approval helpers ──────────────────────────────────────────────────────
  const submitApproval = async (status: "Approved" | "Rejected", notes?: string) => {
    setApprovalSubmitting(true);
    setApprovalError(null);
    try {
      const updated = await setApproval({ regNo, status, reviewedBy: REVIEWER_NAME, notes });
      setApprovalRecord(updated);
    } catch (e) {
      setApprovalError(e instanceof Error ? e.message : "Failed to save decision.");
    } finally {
      setApprovalSubmitting(false);
    }
  };

  const handleApprove = (notes?: string) => submitApproval("Approved", notes);
  const handleReject  = (notes?: string) => submitApproval("Rejected",  notes);

  // Nav status badge derived from approval record
  const navSm = statusMeta(approvalRecord?.status as ApprovalStatus | undefined);

  if (!doc) {
    return (
      <div className="h-screen flex flex-col bg-[#f8f9fc]">
        <nav className="shrink-0 border-b border-slate-200 bg-white">
          <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center">
            <button onClick={onBack} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 text-sm font-medium">
              <ArrowLeft size={15} /> Back
            </button>
          </div>
        </nav>
        <div className="flex-1 flex items-center justify-center text-slate-500">
          No review document returned for {regNo}.
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#f8f9fc] overflow-hidden">
      {/* Nav */}
      <nav className="shrink-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          {/* Left */}
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors text-sm font-medium">
              <ArrowLeft size={15} />New Review
            </button>
            <div className="h-5 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
                <FileText size={13} className="text-white" />
              </div>
              <span className="font-bold text-slate-900 tracking-tight">LIMS Review</span>
              <span className="text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full">AI</span>
              <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded-full inline-flex items-center gap-1">
                <Database size={9} />Reg. No
              </span>
            </div>
          </div>

          {/* Right */}
          <div className="flex items-center gap-3">
            {/* Approval status badge */}
            {!approvalLoading && (
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border inline-flex items-center gap-1.5 ${navSm.bgClass} ${navSm.borderClass} ${navSm.colorClass}`}>
                {approvalRecord?.status === "Approved" && <ShieldCheck size={10} />}
                {approvalRecord?.status === "Rejected" && <ShieldX     size={10} />}
                {(!approvalRecord || approvalRecord.status === "Pending") && <Clock size={10} />}
                {approvalRecord?.status ?? "Pending"}
              </span>
            )}

            <div className="text-right">
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Score</p>
              <p className="text-xl font-black text-slate-900 leading-tight">
                {doc.score}<span className="text-xs font-normal text-slate-400">/100</span>
              </p>
            </div>

            {unresolvedBlocks > 0 ? (
              <div className="px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 flex items-center gap-1.5">
                <XCircle size={12} className="text-red-500" />
                <span className="text-xs font-bold text-red-700">{unresolvedBlocks} block{unresolvedBlocks !== 1 ? "s" : ""}</span>
              </div>
            ) : pendingCount > 0 ? (
              <div className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-1.5">
                <AlertTriangle size={12} className="text-amber-500" />
                <span className="text-xs font-bold text-amber-700">{pendingCount} pending</span>
              </div>
            ) : (
              <div className="px-3 py-1.5 rounded-lg bg-green-50 border border-green-200 flex items-center gap-1.5">
                <CheckCircle2 size={12} className="text-green-600" />
                <span className="text-xs font-bold text-green-700">All actioned</span>
              </div>
            )}

            <div className="h-5 w-px bg-slate-200" />

            {/* Audit log button */}
            <button
              onClick={() => setAuditOpen(true)}
              className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-400 rounded-lg px-3 py-2 transition-all"
            >
              <ScrollText size={12} />Audit Log
            </button>

            <button
              onClick={() => exportReviewToPdf(
                { ...result, documents: [doc], overallScore: doc.score },
                { fileNames: [doc.fileName ?? regNo], generatedAt: new Date(), metadata: docMeta ? [docMeta] : undefined, correlationId, model, orgName: "Edward Food Research & Analysis Centre Ltd", orgSub: "AQIMA Group · Kolkata · NABL TC-5817" },
              )}
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-2 transition-colors"
            >
              <Download size={12} />Export
            </button>

            <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-400 rounded-lg px-3 py-2 transition-all">
              <RefreshCw size={12} />Re-analyze
            </button>
          </div>
        </div>
      </nav>

      {/* Approval error toast */}
      {approvalError && (
        <div className="shrink-0 bg-red-50 border-b border-red-200 px-6 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={13} className="text-red-500" />
            <p className="text-xs text-red-700">{approvalError}</p>
          </div>
          <button onClick={() => setApprovalError(null)} className="text-red-400 hover:text-red-700"><X size={13} /></button>
        </div>
      )}

      {/* Body — 3-column split */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden grid"
        style={{ gridTemplateColumns: `260px 1fr 6px ${panelWidth}px` }}
      >
        {/* COL 1 — Expandable sidebar panel */}
        <aside className="border-r border-slate-200 bg-white flex flex-col overflow-hidden">
          {/* Panel header */}
          <div className="shrink-0 px-4 py-3 border-b border-slate-100 flex items-center gap-2.5 bg-slate-50">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 font-mono">LIMS · Review Panel</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* ── Document Card ─────────────────────────────────── */}
            <div className="mx-3 mt-3 mb-1">
              {/* Card mimics a physical document */}
              <div className="rounded-xl overflow-hidden border border-slate-200 bg-white shadow-sm">
                {/* Document top strip */}
                <div className="h-1.5 bg-gradient-to-r from-blue-500 via-blue-600 to-blue-700" />

                {/* Document body */}
                <div className="px-4 py-4">
                  {/* Reg no + status */}
                  <div className="flex items-start justify-between gap-2 mb-3.5">
                    <div>
                      <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-0.5">Registration No.</p>
                      <p className="text-sm font-black text-slate-900 font-mono leading-tight break-all">{regNo}</p>
                    </div>
                    <div className={`shrink-0 px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-[0.1em] border ${
                      unresolvedBlocks > 0
                        ? "bg-red-50 text-red-600 border-red-200"
                        : canApprove
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}>
                      {unresolvedBlocks > 0 ? "Blocked" : canApprove ? "Ready" : "In Review"}
                    </div>
                  </div>

                  {/* Divider with dots */}
                  <div className="flex items-center gap-1 mb-3">
                    <div className="flex-1 h-px border-t border-dashed border-slate-200" />
                    <div className="w-1 h-1 rounded-full bg-slate-300" />
                    <div className="flex-1 h-px border-t border-dashed border-slate-200" />
                  </div>

                  {/* Score */}
                  <div className="flex items-end justify-between gap-2 mb-3">
                    <div>
                      <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-0.5">AI Score</p>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black text-slate-900 leading-none tabular-nums">{doc.score}</span>
                        <span className="text-slate-400 text-xs font-semibold">/100</span>
                      </div>
                    </div>
                    {/* Score ring */}
                    <div className="relative w-12 h-12">
                      <svg viewBox="0 0 44 44" className="w-full h-full -rotate-90">
                        <circle cx="22" cy="22" r="17" fill="none" stroke="#f1f5f9" strokeWidth="4" />
                        <circle
                          cx="22" cy="22" r="17" fill="none"
                          stroke={doc.score >= 80 ? "#10b981" : doc.score >= 60 ? "#f59e0b" : "#ef4444"}
                          strokeWidth="4" strokeLinecap="round"
                          strokeDasharray={`${(doc.score / 100) * 106.8} 106.8`}
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-slate-500">
                        {issuesPercent(doc.score)}%
                      </span>
                    </div>
                  </div>

                  {/* Issue pills */}
                  <div className="flex gap-1.5 flex-wrap mb-3">
                    {errors.length > 0 && (
                      <span className="flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-md bg-red-50 text-red-600 border border-red-200">
                        <XCircle size={8} />{errors.length} error{errors.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    {warnings.length > 0 && (
                      <span className="flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                        <AlertTriangle size={8} />{warnings.length} warn
                      </span>
                    )}
                    {suggestions.length > 0 && (
                      <span className="flex items-center gap-1 text-[9px] font-bold px-2 py-1 rounded-md bg-blue-50 text-blue-600 border border-blue-200">
                        <Lightbulb size={8} />{suggestions.length} tip{suggestions.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    {errors.length === 0 && warnings.length === 0 && suggestions.length === 0 && (
                      <span className="text-[9px] text-slate-400 font-semibold">No issues found</span>
                    )}
                  </div>

                  {/* Progress bar */}
                  {doc.issues.length > 0 && (
                    <div>
                      <div className="flex gap-0.5 h-1.5 rounded-full overflow-hidden mb-1">
                        {modifiedCount > 0 && <div className="bg-blue-500 rounded-full transition-all" style={{ flex: modifiedCount }} />}
                        {ignoredCount  > 0 && <div className="bg-slate-300 rounded-full transition-all" style={{ flex: ignoredCount  }} />}
                        {pendingCount  > 0 && <div className="bg-slate-100 rounded-full border border-slate-200 transition-all" style={{ flex: pendingCount  }} />}
                      </div>
                      <p className="text-[9px] text-slate-400 font-mono">{doc.issues.length - pendingCount}/{doc.issues.length} actioned</p>
                    </div>
                  )}
                </div>

                {/* Document bottom strip - tear line */}
                <div className="border-t border-dashed border-slate-200 bg-slate-50 px-4 py-2.5 flex items-center justify-between">
                  <span className="text-[8px] font-mono text-slate-400 uppercase tracking-widest">LIMS · AI Review</span>
                  <span className="text-[8px] font-mono text-slate-400">{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
                </div>
              </div>
            </div>

            {/* ── Evaluation Heads — collapsible ──── */}
            <SidebarSection title="Evaluation Heads" defaultOpen={true}>
              <div className="space-y-0.5 px-1">
                <button
                  onClick={() => setHeadFilter("all")}
                  className={`w-full text-left rounded-md px-2.5 py-1.5 transition-all duration-150 flex items-center justify-between gap-2 ${
                    headFilter === "all"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <span className="text-[10px] font-semibold font-mono flex items-center gap-2">
                    <span className={`text-[8px] ${headFilter === "all" ? "text-emerald-400" : "text-slate-400"}`}>▶</span>
                    ALL
                  </span>
                  <span className={`text-[9px] font-bold tabular-nums px-1.5 py-0.5 rounded ${headFilter === "all" ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"}`}>
                    {doc.issues.length}
                  </span>
                </button>
                {headCounts.map(({ head, count, errors: hErrs }) => {
                  const active = headFilter === head.code;
                  const empty  = count === 0;
                  return (
                    <button
                      key={head.code}
                      onClick={() => !empty && setHeadFilter(active ? "all" : head.code)}
                      disabled={empty}
                      title={head.description}
                      className={`w-full text-left rounded-md px-2.5 py-1.5 transition-all duration-150 flex items-center justify-between gap-2 ${
                        active  ? "bg-slate-900 text-white"
                        : empty ? "text-slate-300 cursor-not-allowed"
                                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      }`}
                    >
                      <span className="text-[10px] font-semibold font-mono flex items-center gap-2 truncate">
                        <span className={`text-[8px] ${active ? "text-emerald-400" : "text-slate-400"}`}>▶</span>
                        <span className="truncate">{head.code}</span>
                      </span>
                      <span className={`text-[9px] font-bold tabular-nums px-1.5 py-0.5 rounded shrink-0 ${
                        active  ? "bg-white/15 text-white"
                        : hErrs > 0 ? "bg-red-100 text-red-700"
                        : empty ? "bg-slate-50 text-slate-300"
                                : "bg-slate-100 text-slate-600"
                      }`}>{count}</span>
                    </button>
                  );
                })}
                {uncategorisedCount > 0 && (
                  <p className="text-[9px] text-slate-400 px-2.5 pt-1 font-mono">{uncategorisedCount} uncategorised</p>
                )}
              </div>
            </SidebarSection>

            {/* ── Client info (if available) ───────────────────── */}
            {clientName && (
              <SidebarSection title="Client" defaultOpen={false}>
                <div className="px-1">
                  <p className="text-[11px] text-slate-700 font-medium px-2.5 py-1">{clientName}</p>
                </div>
              </SidebarSection>
            )}
          </div>
        </aside>

        {/* COL 2 — LIMS data viewer */}
        <div className="flex flex-col min-h-0 overflow-hidden bg-[#e8eaed]">
          <div className="shrink-0 px-5 py-3 bg-white border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                <Database size={11} className="text-emerald-600" />
              </div>
              <span className="text-slate-700 text-xs font-semibold truncate max-w-[420px] font-mono">{regNo}</span>
              {clientName && <span className="text-slate-400 text-[11px] truncate max-w-[300px]">· {clientName}</span>}
            </div>
            <span className="text-slate-400 text-xs bg-slate-100 px-2 py-0.5 rounded-full">{rows.length} param{rows.length === 1 ? "" : "s"}</span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">

              {/* Header summary card */}
              {header && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Report Header</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 px-5 py-4 text-xs">
                    {([
                      ["Report No.",        header.reportNo],
                      ["Customer",          clientName],
                      ["Customer Ref.",     header.customerRef],
                      ["Kind Atten.",       header.kindAttention],
                      ["Sample Received",   header.sampleReceivedDate],
                      ["Sample Registered", header.sampleRegistrationDate],
                      ["Sample Type",       header.sampleType],
                      ["Batch No.",         header.batchNo],
                    ] as [string, string | null | undefined][])
                      .filter(([, v]) => v != null && String(v).trim() !== "")
                      .map(([k, v]) => (
                        <div key={k} className="flex items-baseline gap-3 border-b border-dashed border-slate-100 pb-1.5">
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] w-32 shrink-0">{k}</span>
                          <span className="text-slate-800 font-medium break-all">{v}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Parameter rows table */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Test Parameters</p>
                </div>

                {rows.length === 0 ? (
                  <div className="px-5 py-10 text-center text-slate-400 text-sm">No parameter rows were returned from LIMS for this registration number.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                          <th className="text-left font-semibold uppercase tracking-[0.08em] text-[10px] px-3 py-2">Group</th>
                          <th className="text-left font-semibold uppercase tracking-[0.08em] text-[10px] px-3 py-2">Parameter</th>
                          <th className="text-left font-semibold uppercase tracking-[0.08em] text-[10px] px-3 py-2 w-20">UOM</th>
                          <th className="text-left font-semibold uppercase tracking-[0.08em] text-[10px] px-3 py-2">Method</th>
                          <th className="text-left font-semibold uppercase tracking-[0.08em] text-[10px] px-3 py-2 w-20">LOQ</th>
                          <th className="text-left font-semibold uppercase tracking-[0.08em] text-[10px] px-3 py-2">Requirements</th>
                          <th className="text-left font-semibold uppercase tracking-[0.08em] text-[10px] px-3 py-2 w-32">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, idx) => {
                          const k = rowKey(r.groupCode ?? r.groupName!, r.parameter!);
                          const edited = editedKeys.has(k);
                          return (
                            <tr key={`${k}-${idx}`} className={`border-b border-slate-100 last:border-b-0 ${edited ? "bg-blue-50/60" : idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                              <td className="px-3 py-2 align-top">{r.groupName}</td>
                              <td className="px-3 py-2 align-top text-slate-800 font-medium">{r.parameter}</td>
                              <td className="px-3 py-2 align-top text-slate-500 font-mono">{r.uom}</td>
                              <td className="px-3 py-2 align-top text-slate-500">{r.method}</td>
                              <td className="px-3 py-2 align-top text-slate-500 font-mono">{r.loq}</td>
                              <td className="px-3 py-2 align-top text-slate-500 font-mono">{r.requirements}</td>
                              <td className="px-3 py-2 align-top">
                                <span className={`font-mono font-semibold ${edited ? "text-blue-700" : "text-slate-900"}`}>{r.results}</span>
                                {edited && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-blue-700 bg-blue-100 border border-blue-200 px-1 py-px rounded">edited</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <p className="text-center text-[11px] text-slate-400">
                Use the &ldquo;Modify&rdquo; button on a finding in the right panel to correct a value &mdash; changes are saved to LIMS instantly.
              </p>
            </div>
          </div>
        </div>

        {/* Resize handle */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize AI Analysis panel"
          aria-valuemin={PANEL_MIN}
          aria-valuemax={PANEL_MAX}
          aria-valuenow={panelWidth}
          tabIndex={0}
          onMouseDown={startResize}
          onTouchStart={startResize}
          onKeyDown={onHandleKeyDown}
          onDoubleClick={() => setPanelWidth(PANEL_DEFAULT)}
          className={`group relative cursor-col-resize select-none border-l border-r transition-colors ${resizing ? "border-slate-400 bg-slate-200" : "border-slate-200 bg-slate-100 hover:bg-slate-200 hover:border-slate-300"}`}
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex flex-col items-center justify-center gap-1 pointer-events-none">
            <span className={`w-0.5 h-0.5 rounded-full ${resizing ? "bg-slate-700" : "bg-slate-400 group-hover:bg-slate-700"}`} />
            <span className={`w-0.5 h-0.5 rounded-full ${resizing ? "bg-slate-700" : "bg-slate-400 group-hover:bg-slate-700"}`} />
            <span className={`w-0.5 h-0.5 rounded-full ${resizing ? "bg-slate-700" : "bg-slate-400 group-hover:bg-slate-700"}`} />
          </div>
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        {/* COL 3 — AI Results */}
        <div className="bg-white flex flex-col overflow-hidden">
          <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.16em] flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-blue-600" />AI Analysis
              </p>
              <p className="text-[10px] font-mono text-slate-400 tabular-nums">01 / 01</p>
            </div>

            <div className="flex gap-1.5 flex-wrap mb-2">
              {(() => {
                const totalPending = errors.length + warnings.length + suggestions.length;
                return [
                  { sev: "all",        label: totalPending < doc.issues.length ? `${totalPending} pending / ${doc.issues.length}` : `All · ${doc.issues.length}`, style: filter === "all" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400" },
                  { sev: "error",      label: `${errors.length} Error${errors.length !== 1 ? "s" : ""}`,         style: filter === "error"      ? "bg-red-600 text-white border-red-600"     : "bg-white text-red-600 border-red-200 hover:bg-red-50" },
                  { sev: "warning",    label: `${warnings.length} Warning${warnings.length !== 1 ? "s" : ""}`,   style: filter === "warning"    ? "bg-amber-500 text-white border-amber-500" : "bg-white text-amber-600 border-amber-200 hover:bg-amber-50" },
                  { sev: "suggestion", label: `${suggestions.length} Tip${suggestions.length !== 1 ? "s" : ""}`, style: filter === "suggestion" ? "bg-blue-600 text-white border-blue-600"   : "bg-white text-blue-600 border-blue-200 hover:bg-blue-50" },
                ].map(({ sev, label, style }) => (
                  <button key={sev} onClick={() => setFilter(sev as typeof filter)} className={`text-[10px] font-bold px-2.5 py-1 rounded border transition-all duration-150 ${style}`}>{label}</button>
                ));
              })()}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Metadata block */}
            {docMeta && (() => {
              const metaFields: [string, string | null | undefined][] = [
                ["Report No.",      docMeta.reportNo],
                ["ULR",             docMeta.ulr],
                ["Customer",        docMeta.customer],
                ["Sample",          docMeta.sample],
                ["Sample / Lot ID", docMeta.sampleId],
                ["Matrix",          docMeta.matrix],
                ["Sub-labs",        docMeta.subLabs],
                ["Method",          docMeta.method],
                ["Doc Class",       docMeta.documentClass ?? docMeta.version],
                ["NABL No.",        docMeta.nabl],
                ["Issued",          docMeta.issuedDate],
                ["Sampling",        docMeta.samplingDate],
                ["Receipt",         docMeta.receiptDate],
                ["Analysis Start",  docMeta.analysisStartDate],
                ["Analysis End",    docMeta.analysisEndDate],
              ].filter(([, v]) => v != null && v !== "") as [string, string][];
              if (metaFields.length === 0) return null;
              return (
                <div className="px-5 pt-4 pb-4 border-b border-slate-100">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.16em] mb-2.5 flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-slate-400" />Report Metadata
                  </p>
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    {metaFields.map(([k, v], i) => (
                      <div key={k} className={`flex items-start gap-2 px-3 py-2 ${i % 2 === 0 ? "bg-white" : "bg-slate-50"} ${i !== 0 ? "border-t border-slate-100" : ""}`}>
                        <span className="text-[9.5px] font-semibold text-slate-400 uppercase tracking-[0.08em] w-24 shrink-0 pt-px">{k}</span>
                        <span className="text-[11px] text-slate-800 font-medium leading-snug break-all">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Score + description */}
            <div className="px-5 pt-4 pb-4 border-b border-slate-100">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl font-black text-slate-900 leading-none tabular-nums">
                  {issuesPercent(doc.score)}<span className="text-base text-slate-400 font-bold">%</span>
                </span>
                <span className="text-xs font-semibold text-slate-500">issues found</span>
              </div>
              <p className="text-[11px] text-slate-400 mb-3">Score {doc.score}/100 · {doc.issues.length} finding{doc.issues.length === 1 ? "" : "s"}</p>

              {doc.issues.length > 0 && (
                <div className="mb-3">
                  <div className="flex gap-1 h-1.5 rounded-full overflow-hidden">
                    {pendingCount  > 0 && <div className="bg-slate-300 rounded-full" style={{ flex: pendingCount  }} />}
                    {modifiedCount > 0 && <div className="bg-blue-500 rounded-full"  style={{ flex: modifiedCount }} />}
                    {ignoredCount  > 0 && <div className="bg-slate-400 rounded-full" style={{ flex: ignoredCount  }} />}
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1">{doc.issues.length - pendingCount} of {doc.issues.length} actioned</p>
                </div>
              )}

              {doc.summary && (
                <p className="text-slate-600 text-xs leading-relaxed border-l-2 border-slate-200 pl-3 italic">{doc.summary}</p>
              )}
            </div>

            {/* ── Approval Panel ─────────────────────────────────────────── */}
            <div className="px-4 py-4 border-b border-slate-100">
              <ApprovalPanel
                regNo={regNo}
                canApprove={canApprove}
                unresolvedBlocks={unresolvedBlocks}
                pendingCount={pendingCount}
                record={approvalRecord}
                submitting={approvalSubmitting}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            </div>

            {/* Issues list */}
            <div className="p-4 space-y-2.5">
              {filtered.length === 0 ? (() => {
                // Check if there are actioned items of this type (resolved) or truly none
                const allIssues = doc?.issues ?? [];
                const hasResolvedOfType =
                  filter === "all"        ? allIssues.some((i) => (issueActions[i.id] ?? "pending") !== "pending") :
                  filter === "error"      ? allIssues.some((i) => i.severity === "error"      && (issueActions[i.id] ?? "pending") !== "pending") :
                  filter === "warning"    ? allIssues.some((i) => i.severity === "warning"    && (issueActions[i.id] ?? "pending") !== "pending") :
                  filter === "suggestion" ? allIssues.some((i) => i.severity === "suggestion" && (issueActions[i.id] ?? "pending") !== "pending") :
                  false;
                return (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className={`w-14 h-14 rounded-2xl border flex items-center justify-center mb-3 ${hasResolvedOfType ? "bg-green-50 border-green-200" : "bg-slate-100 border-slate-200"}`}>
                      <CheckCircle2 size={24} className={hasResolvedOfType ? "text-green-500" : "text-slate-500"} />
                    </div>
                    <p className="text-slate-700 font-semibold text-sm">
                      {hasResolvedOfType
                        ? filter === "all" ? "All findings resolved" : `All ${filter}s resolved`
                        : filter === "all" ? "No issues found"       : `No ${filter} items`}
                    </p>
                    <p className="text-slate-400 text-xs mt-1">
                      {hasResolvedOfType ? "Every item in this category has been actioned." : "This report is clean in this category."}
                    </p>
                  </div>
                );
              })() : (
                filtered.map((issue: Issue, i: number) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    index={i}
                    action={getAction(issue.id)}
                    onAction={(a) => setAction(issue.id, a)}
                    rowsLookup={rowsLookup}
                    onSaveEdits={handleSaveEdits}
                    allRows={rows}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Audit log drawer (slides in from right) */}
      {auditOpen && <AuditLogDrawer regNo={regNo} onClose={() => setAuditOpen(false)} />}
    </div>
  );
}