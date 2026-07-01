import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  FileText,
  XCircle,
  AlertTriangle,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  File,
  RefreshCw,
  BookOpen,
  Download,
  Check,
  Pencil,
  X,
  RotateCcw,
} from "lucide-react";
import type { IssueSeverity } from "../types/DocumentReview";
import type { Issue } from "../types/Issue";
import type { ReviewResult } from "../types/ReviewResult";
import type { UploadedFile } from "../types/UploadedFile";
import { HEADS, type HeadCode } from "../types/Head";
import PdfViewer from "./PdfViewer";
import { exportReviewToPdf } from "../utils/exportReviewPdf";
import type { ReportMetadata } from "../services/pdfReviewClient";

interface Props {
  files: UploadedFile[];
  result: ReviewResult;
  metadata?: ReportMetadata[];
  correlationId?: string;
  model?: string;
  onBack: () => void;
}

// Per-issue action state
type IssueAction = "pending" | "accepted" | "modified" | "rejected";

// ─── Remark type classification (L1-M10) ─────────────────────────────────────
const REMARK_TYPES = [
  { type: "A", label: "Compliant",     leftBorder: "border-l-emerald-500", bg: "bg-emerald-50/40", textClass: "text-emerald-700", description: "All parameters within specification" },
  { type: "B", label: "With caveat",   leftBorder: "border-l-amber-400",   bg: "bg-amber-50/40",   textClass: "text-amber-700",   description: "Complies subject to stated condition or scope limitation" },
  { type: "C", label: "Non-compliant", leftBorder: "border-l-red-500",     bg: "bg-red-50/40",     textClass: "text-red-700",     description: "One or more parameters failed specification" },
  { type: "D", label: "MU disclosed",  leftBorder: "border-l-blue-400",    bg: "bg-blue-50/40",    textClass: "text-blue-700",    description: "Measurement Uncertainty declared; decision rule applied per NABL-164" },
  { type: "E", label: "Out of scope",  leftBorder: "border-l-slate-400",   bg: "bg-slate-50",      textClass: "text-slate-600",   description: "Parameter not in NABL accreditation scope — marked with asterisk" },
] as const;

function deriveRemarkType(issues: Array<{ severity: string; headCode?: string }>) {
  if (!issues.length) return REMARK_TYPES[0];
  const hasBlock = issues.some((i) => i.severity === "error");
  const hasMU    = issues.some((i) => i.severity === "warning" && (i.headCode === "PARAMS" || i.headCode === "REGULATORY"));
  const hasScope = issues.some((i) => i.headCode === "REGULATORY" && i.severity === "suggestion");
  if (hasBlock)       return REMARK_TYPES[2]; // C
  if (hasMU)          return REMARK_TYPES[3]; // D
  if (hasScope)       return REMARK_TYPES[4]; // E
  if (issues.length)  return REMARK_TYPES[1]; // B
  return REMARK_TYPES[0];                      // A
}

// ─── Auto-attach comment triggers (L1-M10) ───────────────────────────────────
function deriveAutoAttach(issues: Array<{ title: string; description?: string; headCode?: string; severity: string }>) {
  const text = issues.map((i) => `${i.title} ${i.description ?? ""}`).join(" ").toLowerCase();
  const tags: { icon: string; text: string; severity: "warning" | "info" }[] = [];
  if (text.includes("tin") && text.includes("loq"))
    tags.push({ icon: "⚗", text: "Tin reported at LOQ — verify by re-test before issue.", severity: "warning" });
  if (text.includes("methyl") && text.includes("mercury") && text.includes("total"))
    tags.push({ icon: "🧪", text: "Methyl Mercury speciation method differs from Total Hg method.", severity: "info" });
  if (text.includes("fssai") && (text.includes("surveillance") || text.includes("government")))
    tags.push({ icon: "🏛", text: "FSSAI surveillance sample — chain of custody must be maintained.", severity: "warning" });
  if (text.includes("pet") && (text.includes("migration") || text.includes("antimony") || text.includes("sb")))
    tags.push({ icon: "🧴", text: "PET-Sb context: low Sb indicates virgin resin or Ge/Ti-catalysed PET.", severity: "info" });
  const hasBlockIssue = issues.some((i) => i.severity === "error" && i.headCode === "PARAMS");
  const hasConformanceMismatch = issues.some((i) => i.title.toLowerCase().includes("front") && i.title.toLowerCase().includes("conforms"));
  if (hasBlockIssue || hasConformanceMismatch)
    tags.push({ icon: "⛔", text: "One or more sub-lab sections show Non-Conformance — overall verdict must be updated.", severity: "warning" });
  return tags;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const issuesPercent = (s: number) => Math.max(0, Math.min(100, 100 - s));

// Neutral, classic palette — no quality gradient. Severity stays on issue cards only.
const scoreColors = (_s: number) => ({
  ring: "stroke-slate-700",
  text: "text-slate-900",
  bg: "bg-slate-50",
  border: "border-slate-200",
  badge: "bg-slate-100 text-slate-700 border border-slate-200",
});

const SEVERITY_META: Record<IssueSeverity, {
  Icon: React.ElementType; iconClass: string; badge: string; leftBorder: string; header: string; expandBg: string;
}> = {
  error: {
    Icon: XCircle, iconClass: "text-red-500",
    badge: "bg-red-100 text-red-700 border border-red-200",
    leftBorder: "border-l-red-500",
    header: "hover:bg-red-50/50",
    expandBg: "bg-red-50/60",
  },
  warning: {
    Icon: AlertTriangle, iconClass: "text-amber-500",
    badge: "bg-amber-100 text-amber-700 border border-amber-200",
    leftBorder: "border-l-amber-400",
    header: "hover:bg-amber-50/50",
    expandBg: "bg-amber-50/60",
  },
  suggestion: {
    Icon: Lightbulb, iconClass: "text-blue-500",
    badge: "bg-blue-100 text-blue-700 border border-blue-200",
    leftBorder: "border-l-blue-400",
    header: "hover:bg-blue-50/30",
    expandBg: "bg-blue-50/60",
  },
};

// Per-action styling
const ACTION_META: Record<IssueAction, { label: string; bg: string; text: string; border: string }> = {
  pending:  { label: "Pending",  bg: "bg-slate-100",  text: "text-slate-500",  border: "border-slate-200" },
  accepted: { label: "Accepted", bg: "bg-green-50",   text: "text-green-700",  border: "border-green-200" },
  modified: { label: "Modified", bg: "bg-blue-50",    text: "text-blue-700",   border: "border-blue-200"  },
  rejected: { label: "Rejected", bg: "bg-red-50",     text: "text-red-700",    border: "border-red-200"   },
};

interface IssueCardProps {
  issue: Issue;
  index: number;
  action: IssueAction;
  onAction: (action: IssueAction) => void;
}

function IssueCard({ issue, index, action, onAction }: IssueCardProps) {
  const [open, setOpen] = useState(false);
  const m = SEVERITY_META[issue.severity];
  const Icon = m.Icon;
  const isBlock = issue.severity === "error";
  const am = ACTION_META[action];

  // Left border colour reflects action state when resolved
  const resolvedBorder =
    action === "accepted" ? "border-l-green-500" :
    action === "modified" ? "border-l-blue-500"  :
    action === "rejected" ? "border-l-red-400"   :
    m.leftBorder;

  return (
    <div
      className={`rounded-xl border border-l-[3px] ${resolvedBorder} border-slate-200 bg-white overflow-hidden transition-all duration-150 hover:border-slate-300 ${
        action !== "pending" ? "opacity-80" : ""
      }`}
    >
      {/* Collapsible header */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-slate-50/60 transition-colors duration-150"
      >
        <Icon size={16} className={`${m.iconClass} shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <span className="text-[10px] font-mono text-slate-400 tabular-nums">
              #{String(index + 1).padStart(2, "0")}
            </span>
            <span className={`text-[9.5px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded ${m.badge}`}>
              {issue.severity}
            </span>
            {issue.headCode && (
              <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-700 bg-slate-100 border border-slate-300 px-1.5 py-0.5 rounded">
                {issue.headCode}
              </span>
            )}
            {issue.evidence?.rule?.code && (
              <span className="text-[9.5px] font-mono text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
                {issue.evidence.rule.code}
              </span>
            )}
            {/* Bold-enforcement indicator (Rule 6.3 / HYGIENE formatting defect) */}
            {issue.headCode === "HYGIENE" && (issue.title.toLowerCase().includes("bold") || issue.title.toLowerCase().includes("formatting")) && (
              <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-slate-700 bg-slate-100 border border-slate-300 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                <span className="font-bold text-[10px]">B</span>fmt
              </span>
            )}
            {issue.page && (
              <span className="text-[10px] text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                p. {issue.page}
              </span>
            )}
            {/* Action status badge */}
            {action !== "pending" && (
              <span className={`text-[9.5px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded border ${am.bg} ${am.text} ${am.border}`}>
                {am.label}
              </span>
            )}
          </div>
          <p className="text-slate-900 font-semibold text-sm leading-snug">{issue.title}</p>
          {issue.location && (
            <p className="text-slate-400 text-[11px] mt-1 truncate">{issue.location}</p>
          )}
        </div>
        <span className="text-slate-300 shrink-0 mt-1">
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </span>
      </button>

      {/* Expanded body */}
      {open && (
        <div className="border-t border-slate-100 px-4 py-4 space-y-4 bg-slate-50/40">
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.14em] mb-1.5">Description</p>
            <p className="text-slate-700 text-xs leading-relaxed">{issue.description}</p>
          </div>

          {issue.evidence && (
            <div className="bg-white rounded-lg border border-slate-200 p-3.5 space-y-2.5">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.14em]">
                What the engine compared
              </p>
              {issue.evidence.compared && issue.evidence.compared.length > 0 && (
                <div className="font-mono text-[11px] leading-relaxed space-y-1">
                  {issue.evidence.compared.map((c, idx) => (
                    <div key={idx} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="inline-block min-w-[80px] text-slate-500">{c.label}</span>
                      {c.old !== undefined && (
                        <span className="text-slate-400 line-through">{c.old}</span>
                      )}
                      {c.old !== undefined && c.new !== undefined && (
                        <span className="text-slate-300">→</span>
                      )}
                      {c.new !== undefined && (
                        <span className="text-slate-900 font-semibold">{c.new}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {issue.evidence.verdict && (
                <p className="pt-2 border-t border-dashed border-slate-200 text-[11px] font-semibold text-red-600">
                  {issue.evidence.verdict}
                </p>
              )}
              {issue.evidence.rule && (
                <p className="text-[10px] text-slate-400 font-mono">
                  Rule {issue.evidence.rule.code}
                  {issue.evidence.rule.version ? ` · ${issue.evidence.rule.version}` : ""}
                </p>
              )}
              {issue.evidence.trace && issue.evidence.trace.length > 0 && (
                <div className="pt-2 border-t border-dashed border-slate-200 space-y-1">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.14em] mb-1">
                    How the rule fired
                  </p>
                  {issue.evidence.trace.map((t, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-[11px]">
                      <span className="font-mono font-bold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-[9px] shrink-0">
                        {t.tag}
                      </span>
                      <span className="text-slate-700 leading-relaxed">{t.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* "What to do" action box — mirrors .f-action from the HTML spec */}
          {issue.suggestion && (
            <div className="bg-white rounded-lg border border-blue-100 border-l-[3px] border-l-blue-500 p-3.5">
              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-[0.14em] mb-1.5 flex items-center gap-1.5">
                <Lightbulb size={10} className="text-blue-500" />
                What to do
              </p>
              <p className="text-slate-700 text-xs leading-relaxed">{issue.suggestion}</p>
            </div>
          )}

          {issue.location && (
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <BookOpen size={10} />
              {issue.location}
            </div>
          )}

          {/* ── Action buttons ── */}
          <div className="pt-1 border-t border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.14em] mb-2">
              How do you want to handle this?
            </p>
            <div className="flex items-center gap-2 flex-wrap">

              {/* Accept — disabled for errors/BLOCKs */}
              <button
                onClick={() => onAction(action === "accepted" ? "pending" : "accepted")}
                disabled={isBlock}
                title={isBlock ? "Cannot accept while BLOCK (error) is unresolved — use Modify or Reject" : "Accept this finding"}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all duration-150
                  ${action === "accepted"
                    ? "bg-green-600 text-white border-green-600"
                    : "bg-white text-green-700 border-green-300 hover:bg-green-50 hover:border-green-500"
                  }
                  disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-green-300
                `}
              >
                <Check size={11} />
                Accept
              </button>

              {/* Modify */}
              <button
                onClick={() => onAction(action === "modified" ? "pending" : "modified")}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all duration-150
                  ${action === "modified"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-blue-700 border-blue-300 hover:bg-blue-50 hover:border-blue-500"
                  }
                `}
              >
                <Pencil size={11} />
                Modify
              </button>

              {/* Reject */}
              <button
                onClick={() => onAction(action === "rejected" ? "pending" : "rejected")}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all duration-150
                  ${action === "rejected"
                    ? "bg-red-600 text-white border-red-600"
                    : "bg-white text-red-700 border-red-300 hover:bg-red-50 hover:border-red-500"
                  }
                `}
              >
                <X size={11} />
                Reject
              </button>

              {/* Reset to pending if already actioned */}
              {action !== "pending" && (
                <button
                  onClick={() => onAction("pending")}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-slate-400 border border-slate-200 hover:text-slate-600 hover:border-slate-400 transition-all duration-150 ml-auto"
                  title="Reset to pending"
                >
                  <RotateCcw size={10} />
                  Reset
                </button>
              )}
            </div>

            {/* Contextual guidance text below buttons */}
            {isBlock && action === "pending" && (
              <p className="mt-2 text-[10px] text-red-500 leading-relaxed">
                ⛔ This is a blocking error — it must be <strong>Modified</strong> (corrective action taken) or <strong>Rejected</strong> before the report can be approved.
              </p>
            )}
            {issue.severity === "warning" && action === "pending" && (
              <p className="mt-2 text-[10px] text-amber-600 leading-relaxed">
                ⚠ This warning needs a decision — accept as-is, modify the report, or reject and send back.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const PANEL_MIN = 320;
const PANEL_MAX = 720;
const PANEL_DEFAULT = 420;
const PANEL_STORAGE_KEY = "docreview.aiPanelWidth";

export default function ReviewPage({ files, result, metadata, correlationId, model, onBack }: Props) {

    console.log("metadata-review", metadata)
  const [activeDoc, setActiveDoc] = useState(0);
  const [filter, setFilter] = useState<"all" | IssueAction | IssueSeverity>("all");
  const [headFilter, setHeadFilter] = useState<"all" | HeadCode>("all");

  // Per-issue action state: keyed by issue.id
  const [issueActions, setIssueActions] = useState<Record<string, IssueAction>>({});

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (typeof window === "undefined") return PANEL_DEFAULT;
    const stored = Number(window.localStorage.getItem(PANEL_STORAGE_KEY));
    if (Number.isFinite(stored) && stored >= PANEL_MIN && stored <= PANEL_MAX) {
      return stored;
    }
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

    const getX = (ev: MouseEvent | TouchEvent) =>
      "touches" in ev ? ev.touches[0]?.clientX ?? 0 : ev.clientX;

    const onMove = (ev: MouseEvent | TouchEvent) => {
      const right = containerRef.current?.getBoundingClientRect().right ?? window.innerWidth;
      const next = right - getX(ev);
      setPanelWidth(Math.max(PANEL_MIN, Math.min(PANEL_MAX, next)));
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
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setPanelWidth((w) => Math.min(PANEL_MAX, w + 24));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setPanelWidth((w) => Math.max(PANEL_MIN, w - 24));
    } else if (e.key === "Home") {
      e.preventDefault();
      setPanelWidth(PANEL_DEFAULT);
    }
  }, []);

  const doc = result.documents[activeDoc];
  const file = files.find((f) => f.id === doc.fileId) ?? files[activeDoc];

  // Per-document AI-extracted metadata — indexed in the same order as result.documents
  const docMeta = metadata?.[activeDoc];

  const errors      = doc.issues.filter((i) => i.severity === "error");
  const warnings    = doc.issues.filter((i) => i.severity === "warning");
  const suggestions = doc.issues.filter((i) => i.severity === "suggestion");

  // Counts by action state
  const pendingCount  = doc.issues.filter((i) => (issueActions[i.id] ?? "pending") === "pending").length;
  const acceptedCount = doc.issues.filter((i) => issueActions[i.id] === "accepted").length;
  const modifiedCount = doc.issues.filter((i) => issueActions[i.id] === "modified").length;
  const rejectedCount = doc.issues.filter((i) => issueActions[i.id] === "rejected").length;

  // Unresolved blocking errors
  const unresolvedBlocks = errors.filter(
    (i) => (issueActions[i.id] ?? "pending") === "pending"
  ).length;
  const canApprove = unresolvedBlocks === 0 && pendingCount === 0;

  const getAction = (id: string): IssueAction => issueActions[id] ?? "pending";
  const setAction = (id: string, action: IssueAction) =>
    setIssueActions((prev) => ({ ...prev, [id]: action }));

  // Per-head counts for the heads strip
  const headCounts = HEADS.map((h) => ({
    head: h,
    count: doc.issues.filter((i) => i.headCode === h.code).length,
    errors: doc.issues.filter((i) => i.headCode === h.code && i.severity === "error").length,
  }));
  const uncategorisedCount = doc.issues.filter((i) => !i.headCode).length;

  // Filter logic — head AND severity/action chips both apply
  const filtered = doc.issues.filter((i) => {
    if (headFilter !== "all" && i.headCode !== headFilter) return false;
    if (filter === "all")        return true;
    if (filter === "error")      return i.severity === "error";
    if (filter === "warning")    return i.severity === "warning";
    if (filter === "suggestion") return i.severity === "suggestion";
    if (filter === "pending")    return getAction(i.id) === "pending";
    if (filter === "accepted")   return getAction(i.id) === "accepted";
    if (filter === "modified")   return getAction(i.id) === "modified";
    if (filter === "rejected")   return getAction(i.id) === "rejected";
    return true;
  });

  return (
    <div className="h-screen flex flex-col bg-[#f8f9fc] overflow-hidden">
      {/* Nav */}
      <nav className="shrink-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors text-sm font-medium"
            >
              <ArrowLeft size={15} />
              New Review
            </button>
            <div className="h-5 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
                <FileText size={13} className="text-white" />
              </div>
              <span className="font-bold text-slate-900 tracking-tight">LIMS Review</span>
              <span className="text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full">AI</span>
            </div>
          </div>

          {/* Overall score + approval gate */}
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                {result.documents.length > 1 ? `Report ${activeDoc + 1} of ${result.documents.length}` : "Score"}
              </p>
              <p className="text-xl font-black text-slate-900 leading-tight">
                {doc.score}<span className="text-xs font-normal text-slate-400">/100</span>
              </p>
            </div>

            {/* Approval status chip */}
            {unresolvedBlocks > 0 ? (
              <div className="px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 flex items-center gap-1.5">
                <XCircle size={12} className="text-red-500" />
                <span className="text-xs font-bold text-red-700">
                  {unresolvedBlocks} block{unresolvedBlocks !== 1 ? "s" : ""} in this report
                </span>
              </div>
            ) : pendingCount > 0 ? (
              <div className="px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-1.5">
                <AlertTriangle size={12} className="text-amber-500" />
                <span className="text-xs font-bold text-amber-700">
                  {pendingCount} pending
                </span>
              </div>
            ) : (
              <div className="px-3 py-1.5 rounded-lg bg-green-50 border border-green-200 flex items-center gap-1.5">
                <CheckCircle2 size={12} className="text-green-600" />
                <span className="text-xs font-bold text-green-700">All actioned</span>
              </div>
            )}

            <div className="h-5 w-px bg-slate-200" />
            <button
              onClick={() => {
                // Export only the currently selected document with its own metadata
                const activeFile = files.find((f) => f.id === doc.fileId) ?? files[activeDoc];
                const singleDocResult = {
                  ...result,
                  documents: [doc],
                  // Use this document's own score as the overallScore so the PDF cover is correct
                  overallScore: doc.score,
                };
                exportReviewToPdf(singleDocResult, {
                  fileNames: [activeFile?.name ?? doc.fileName],
                  generatedAt: new Date(),
                  // Pass only this document's metadata at index 0 — matches the single-doc result
                  metadata: docMeta ? [docMeta] : undefined,
                  correlationId,
                  model,
                  orgName: "Edward Food Research & Analysis Centre Ltd",
                  orgSub: "AQIMA Group · Kolkata · NABL TC-5817",
                });
              }}
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-2 transition-colors"
              title={`Export PDF for: ${doc.fileName}`}
            >
              <Download size={12} />
              Export Report
            </button>
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-400 rounded-lg px-3 py-2 transition-all"
            >
              <RefreshCw size={12} />
              Re-analyze
            </button>

            {/* Approve — disabled until all blocks resolved */}
            <button
              disabled={!canApprove}
              title={!canApprove ? "All findings must be actioned before approving" : "Approve this report"}
              className={`
                flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-2 border transition-all
                ${canApprove
                  ? "bg-green-600 hover:bg-green-700 text-white border-green-600"
                  : "bg-slate-300 text-slate-500 border-slate-300 cursor-not-allowed opacity-60"
                }
              `}
            >
              <CheckCircle2 size={12} />
              Approve Report
            </button>
          </div>
        </div>
      </nav>

      {/* Body — 3-column split (right panel resizable) */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden grid"
        style={{ gridTemplateColumns: `260px 1fr 6px ${panelWidth}px` }}
      >

        {/* COL 1 — Document list */}
        <aside className="border-r border-slate-200 bg-white flex flex-col overflow-y-auto">
          <div className="px-4 py-4 border-b border-slate-100">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
              Documents ({files.length})
            </p>
          </div>

          {/* Overall stats */}
          <div className="px-4 py-3 border-b border-slate-100 grid grid-cols-3 gap-2">
            {[
              { label: "Errors",   count: result.documents.reduce((s, d) => s + d.issues.filter((i) => i.severity === "error").length, 0),    color: "text-red-600",   bg: "bg-red-50" },
              { label: "Warns",    count: result.documents.reduce((s, d) => s + d.issues.filter((i) => i.severity === "warning").length, 0),   color: "text-amber-600", bg: "bg-amber-50" },
              { label: "Tips",     count: result.documents.reduce((s, d) => s + d.issues.filter((i) => i.severity === "suggestion").length, 0), color: "text-blue-600",  bg: "bg-blue-50" },
            ].map(({ label, count, color, bg }) => (
              <div key={label} className={`${bg} rounded-xl p-2 text-center`}>
                <p className={`text-lg font-black ${color}`}>{count}</p>
                <p className="text-[9px] font-semibold text-slate-500">{label}</p>
              </div>
            ))}
          </div>

          <div className="p-3 space-y-2">
            {result.documents.map((d, i) => {
              const c = scoreColors(d.score);
              const errs = d.issues.filter((x) => x.severity === "error").length;
              const active = activeDoc === i;
              return (
                <button
                  key={d.fileId}
                  onClick={() => { setActiveDoc(i); setFilter("all"); setHeadFilter("all"); }}
                  className={`
                    w-full text-left rounded-2xl p-3 border transition-all duration-200
                    ${active
                      ? "bg-blue-600 border-blue-600"
                      : "bg-white border-slate-200 hover:border-slate-400 hover:bg-slate-50"
                    }
                  `}
                >
                  <div className="flex items-center gap-2 mb-2.5">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-white/15" : "bg-slate-100"}`}>
                      <File size={12} className={active ? "text-white" : "text-slate-500"} />
                    </div>
                    <p className={`text-[11px] font-bold truncate ${active ? "text-white" : "text-slate-700"}`}>
                      {d.fileName.replace(/\.pdf$/i, "")}
                    </p>
                  </div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`text-xs font-black ${active ? "text-white" : c.text}`}>
                      {d.score}/100
                    </span>
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                      active ? "bg-white/15 text-white" : c.badge
                    }`}>
                      {issuesPercent(d.score)}% issues
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {(() => {
                      const dErrs = d.issues.filter((x) => x.severity === "error").length;
                      const dWarns = d.issues.filter((x) => x.severity === "warning").length;
                      const dTips = d.issues.filter((x) => x.severity === "suggestion").length;
                      return (<>
                        {dErrs > 0 && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${active ? "bg-red-400/30 text-white" : "bg-red-100 text-red-700"}`}>{dErrs} err</span>}
                        {dWarns > 0 && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${active ? "bg-amber-400/30 text-white" : "bg-amber-100 text-amber-700"}`}>{dWarns} warn</span>}
                        {dTips > 0 && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${active ? "bg-blue-400/30 text-white" : "bg-blue-100 text-blue-700"}`}>{dTips} tip</span>}
                        {dErrs === 0 && dWarns === 0 && dTips === 0 && <span className={`text-[9px] font-semibold ${active ? "text-white/60" : "text-slate-400"}`}>No issues</span>}
                      </>);
                    })()}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Evaluation Heads — moved from right panel */}
          <div className="border-t border-slate-100 px-3 py-3">
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.14em] mb-2">
              Evaluation Heads
            </p>
            <div className="space-y-1">
              <button
                onClick={() => setHeadFilter("all")}
                className={`w-full text-left rounded-lg border px-2 py-1.5 transition-all duration-150 ${
                  headFilter === "all"
                    ? "bg-slate-900 border-slate-900 text-white"
                    : "bg-white border-slate-200 hover:border-slate-400 text-slate-700"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.06em] truncate">
                    All heads
                  </span>
                  <span className={`text-[9px] font-bold tabular-nums px-1.5 py-0.5 rounded ${
                    headFilter === "all" ? "bg-white/15 text-white" : "bg-slate-100 text-slate-700"
                  }`}>
                    {doc.issues.length}
                  </span>
                </div>
              </button>
              {headCounts.map(({ head, count, errors: hErrs }) => {
                const active = headFilter === head.code;
                const empty = count === 0;
                return (
                  <button
                    key={head.code}
                    onClick={() => !empty && setHeadFilter(active ? "all" : head.code)}
                    disabled={empty}
                    title={head.description}
                    className={`w-full text-left rounded-lg border px-2 py-1.5 transition-all duration-150 ${
                      active
                        ? "bg-slate-900 border-slate-900 text-white"
                        : empty
                        ? "bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed"
                        : "bg-white border-slate-200 hover:border-slate-400 text-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-[0.06em] truncate flex items-center gap-1.5">
                        <span className={`font-mono ${active ? "text-white/70" : "text-slate-400"}`}>
                          {head.id}.
                        </span>
                        {head.code}
                      </span>
                      <span className={`text-[9px] font-bold tabular-nums px-1.5 py-0.5 rounded shrink-0 ${
                        active
                          ? "bg-white/15 text-white"
                          : hErrs > 0
                          ? "bg-red-100 text-red-700"
                          : empty
                          ? "bg-slate-100 text-slate-300"
                          : "bg-slate-100 text-slate-700"
                      }`}>
                        {count}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            {uncategorisedCount > 0 && (
              <p className="text-[9px] text-slate-400 mt-1.5">
                {uncategorisedCount} finding{uncategorisedCount === 1 ? "" : "s"} not assigned to a head
              </p>
            )}
          </div>
        </aside>

        {/* COL 2 — PDF Viewer */}
        <div className="flex flex-col min-h-0 overflow-hidden bg-[#e8eaed]">
          {/* Viewer toolbar */}
          <div className="shrink-0 px-5 py-3 bg-white border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center">
                <File size={11} className="text-slate-500" />
              </div>
              <span className="text-slate-700 text-xs font-semibold truncate max-w-[260px]">
                {file?.name}
              </span>
            </div>
            <span className="text-slate-400 text-xs bg-slate-100 px-2 py-0.5 rounded-full">
              {formatSize(file?.size ?? 0)}
            </span>
          </div>

          {/* PDF pages — scrollable */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            {file?.objectUrl ? (
              <PdfViewer
                key={file.id + activeDoc}
                url={file.objectUrl}
                fileName={file.name}
                scale={1.4}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-4 py-20">
                <File size={48} className="text-slate-300" />
                <p className="text-sm">No preview available</p>
              </div>
            )}
          </div>
        </div>

        {/* Resize handle — between PDF and AI Results */}
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
          className={`group relative cursor-col-resize select-none border-l border-r transition-colors ${
            resizing
              ? "border-slate-400 bg-slate-200"
              : "border-slate-200 bg-slate-100 hover:bg-slate-200 hover:border-slate-300"
          }`}
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
          {/* Sticky header */}
          <div className="shrink-0 px-5 pt-4 pb-3 border-b border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.16em] flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-blue-600" />
                AI Analysis
              </p>
              <p className="text-[10px] font-mono text-slate-400 tabular-nums">
                {String(activeDoc + 1).padStart(2, "0")} / {String(result.documents.length).padStart(2, "0")}
              </p>
            </div>

            {/* Severity filter chips */}
            <div className="flex gap-1.5 flex-wrap mb-2">
              {[
                { sev: "all",        label: `All · ${doc.issues.length}`, style: filter === "all" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400" },
                { sev: "error",      label: `${errors.length} Error${errors.length !== 1 ? "s" : ""}`,           style: filter === "error"      ? "bg-red-600 text-white border-red-600"        : "bg-white text-red-600 border-red-200 hover:bg-red-50" },
                { sev: "warning",    label: `${warnings.length} Warning${warnings.length !== 1 ? "s" : ""}`,     style: filter === "warning"    ? "bg-amber-500 text-white border-amber-500"    : "bg-white text-amber-600 border-amber-200 hover:bg-amber-50" },
                { sev: "suggestion", label: `${suggestions.length} Tip${suggestions.length !== 1 ? "s" : ""}`,   style: filter === "suggestion" ? "bg-blue-600 text-white border-blue-600"      : "bg-white text-blue-600 border-blue-200 hover:bg-blue-50" },
              ].map(({ sev, label, style }) => (
                <button
                  key={sev}
                  onClick={() => setFilter(sev as typeof filter)}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded border transition-all duration-150 ${style}`}
                >
                  {label}
                </button>
              ))}
            </div>

          </div>

          {/* Scrollable: description + issues */}
          <div className="flex-1 overflow-y-auto">

            {/* ── Per-document AI-extracted metadata ── */}
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
                ["Doc Class",       docMeta.documentClass],
                ["Version",         docMeta.version],
                ["NABL No.",        docMeta.nabl],
                ["Issued",          docMeta.issuedDate],
                ["Sampling",        docMeta.samplingDate],
                ["Receipt",         docMeta.receiptDate],
                ["Analysis Start",  docMeta.analysisStartDate],
                ["Analysis End",    docMeta.analysisEndDate],
              ].filter(([, v]) => v != null && v !== "") as [string, string][];

              if (metaFields.length === 0) return null;

              // Amendment detection: version v2, v3… or contains "amendment"/"reanalysis"
              const isAmendment =
                docMeta.version != null &&
                (docMeta.version.match(/v[2-9]/i) || docMeta.version.toLowerCase().includes("amend") || docMeta.version.toLowerCase().includes("reanalys"));

              return (
                <div className="px-5 pt-4 pb-4 border-b border-slate-100">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.16em] mb-2.5 flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-slate-400" />
                    Report Metadata
                  </p>

                  {/* Amendment banner (NABL §7.8.8 — R-AMEND rules) */}
                  {isAmendment && (
                    <div className="mb-2.5 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <span className="text-amber-500 text-[13px] shrink-0 mt-px">△</span>
                      <div>
                        <p className="text-[11px] font-bold text-amber-700">Amendment report — {docMeta.version}</p>
                        <p className="text-[10px] text-amber-600 leading-relaxed">NABL §7.8.8: verify new ULR issued, reason documented, changes traceable, and prior report identified.</p>
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    {metaFields.map(([k, v], i) => (
                      <div
                        key={k}
                        className={`flex items-start gap-2 px-3 py-2 ${
                          i % 2 === 0 ? "bg-white" : "bg-slate-50"
                        } ${i !== 0 ? "border-t border-slate-100" : ""}`}
                      >
                        <span className="text-[9.5px] font-semibold text-slate-400 uppercase tracking-[0.08em] w-24 shrink-0 pt-px">
                          {k}
                        </span>
                        <span className={`text-[11px] font-medium leading-snug break-all ${
                          k === "Version" && isAmendment ? "text-amber-700 font-bold" : "text-slate-800"
                        }`}>
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Description block */}
            <div className="px-5 pt-4 pb-4 border-b border-slate-100">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-3xl font-black text-slate-900 leading-none tabular-nums">
                  {issuesPercent(doc.score)}
                  <span className="text-base text-slate-400 font-bold">%</span>
                </span>
                <span className="text-xs font-semibold text-slate-500">issues found</span>
              </div>
              <p className="text-[11px] text-slate-400 mb-3">
                Score {doc.score}/100 · {doc.issues.length} finding{doc.issues.length === 1 ? "" : "s"}
              </p>

              {/* Progress summary bar */}
              {doc.issues.length > 0 && (
                <div className="mb-3">
                  <div className="flex gap-1 h-1.5 rounded-full overflow-hidden">
                    {pendingCount  > 0 && <div className="bg-slate-300 rounded-full transition-all" style={{ flex: pendingCount }} />}
                    {acceptedCount > 0 && <div className="bg-green-500 rounded-full transition-all" style={{ flex: acceptedCount }} />}
                    {modifiedCount > 0 && <div className="bg-blue-500 rounded-full transition-all" style={{ flex: modifiedCount }} />}
                    {rejectedCount > 0 && <div className="bg-red-400 rounded-full transition-all" style={{ flex: rejectedCount }} />}
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1">
                    {doc.issues.length - pendingCount} of {doc.issues.length} actioned
                  </p>
                </div>
              )}

              {doc.summary && (
                <p className="text-slate-600 text-xs leading-relaxed border-l-2 border-slate-200 pl-3 italic">
                  {doc.summary}
                </p>
              )}

              {/* ── Remark type classification (L1-M10) ── */}
              {(() => {
                const remark = deriveRemarkType(doc.issues);
                return (
                  <div className={`mt-3 flex items-start gap-2 px-3 py-2.5 rounded-lg border-l-[3px] border border-slate-200 ${remark.leftBorder} ${remark.bg}`}>
                    <span className={`text-[10px] font-bold uppercase tracking-[0.12em] shrink-0 mt-px ${remark.textClass}`}>Type {remark.type}</span>
                    <div>
                      <p className={`text-[11px] font-semibold ${remark.textClass}`}>{remark.label}</p>
                      <p className="text-[10px] text-slate-500 leading-relaxed">{remark.description}</p>
                    </div>
                  </div>
                );
              })()}

              {/* ── Auto-attach comment triggers (L1-M10) ── */}
              {(() => {
                const tags = deriveAutoAttach(doc.issues);
                if (!tags.length) return null;
                return (
                  <div className="mt-3 space-y-1.5">
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.14em]">Auto-attach notes</p>
                    {tags.map((t, i) => (
                      <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-lg text-[11px] ${t.severity === "warning" ? "bg-amber-50 border border-amber-200 text-amber-700" : "bg-blue-50 border border-blue-100 text-blue-700"}`}>
                        <span className="shrink-0 text-[12px]" aria-hidden="true">{t.icon}</span>
                        <span className="leading-relaxed">{t.text}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ── Two-person sign-off gate (L1-M11 Rule 11.6) ── */}
              {unresolvedBlocks > 0 && (
                <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                  <XCircle size={13} className="text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[11px] font-bold text-red-700">Two-person sign-off required</p>
                    <p className="text-[10px] text-red-600 leading-relaxed mt-px">
                      {unresolvedBlocks} blocking error{unresolvedBlocks !== 1 ? "s" : ""} present. Both Approver and QA signatory must be present before this report can be approved (L1-M11 Rule 11.6).
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Issues list */}
            <div className="p-4 space-y-2.5">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mb-3">
                    <CheckCircle2 size={24} className="text-slate-500" />
                  </div>
                  <p className="text-slate-700 font-semibold text-sm">
                    {filter === "all" ? "No issues found" : `No ${filter} items`}
                  </p>
                  <p className="text-slate-400 text-xs mt-1">This report is clean in this category.</p>
                </div>
              ) : (
                filtered.map((issue: Issue, i: number) => (
                  <IssueCard
                    key={issue.id}
                    issue={issue}
                    index={i}
                    action={getAction(issue.id)}
                    onAction={(a) => setAction(issue.id, a)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}