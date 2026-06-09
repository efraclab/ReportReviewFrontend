import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  FileText,
  Sparkles,
  Database,
  BookOpen,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  Search,
  ShieldCheck,
  ShieldX,
  Clock,
} from "lucide-react";
import { PdfReviewError } from "../services/pdfReviewClient";
import {
  runRegNoReview,
  type RegNoReviewBundle,
} from "../services/regNoReviewClient";
import {
  getApproval,
  type CoaApprovalRecord,
  type ApprovalStatus,
} from "../services/approvalClient";

interface FriendlyError {
  title: string;
  description: string;
  hint?: string;
  code?: string;
  correlationId?: string;
}

function toFriendlyError(err: unknown): FriendlyError {
  if (err instanceof PdfReviewError) {
    const msg = err.message ?? "";
    const lower = msg.toLowerCase();
    if (lower.includes("credit balance") || lower.includes("billing")) {
      return {
        title: "AI service unavailable — billing issue",
        description:
          "The AI provider can't process this request right now because the account credit balance is too low.",
        hint: "Please contact your administrator to top up the AI provider account, then try again.",
        code: err.errorCode,
        correlationId: err.correlationId,
      };
    }
    switch (err.errorCode) {
      case "VALIDATION_ERROR":
        return {
          title: "We couldn't accept that request",
          description: "The server rejected the registration number. Please verify and try again.",
          hint: msg || undefined,
          code: err.errorCode,
          correlationId: err.correlationId,
        };
      case "AI_RATE_LIMIT":
        return {
          title: "Too many reviews right now",
          description: "We've hit the AI provider's rate limit. Please wait a moment and try again.",
          code: err.errorCode,
          correlationId: err.correlationId,
        };
      case "AI_TIMEOUT":
        return {
          title: "AI took too long to respond",
          description: "The review request timed out. Try again in a moment.",
          code: err.errorCode,
          correlationId: err.correlationId,
        };
      default:
        return {
          title: "Review failed",
          description: msg || "An unexpected error occurred while reviewing this report.",
          code: err.errorCode,
          correlationId: err.correlationId,
        };
    }
  }

  if (err instanceof TypeError) {
    return {
      title: "Network error",
      description:
        "We couldn't reach the review server. Check your internet connection and confirm the backend is running.",
    };
  }

  if (err instanceof Error) {
    return { title: "Review failed", description: err.message || "An unexpected error occurred." };
  }
  return { title: "Review failed", description: "An unexpected error occurred." };
}

// ─── Already-reviewed guard dialog ───────────────────────────────────────────

const STATUS_ICON: Record<ApprovalStatus, React.ElementType> = {
  Approved: ShieldCheck,
  Rejected: ShieldX,
  Pending:  Clock,
};

const STATUS_COLORS: Record<ApprovalStatus, { icon: string; badge: string; bar: string }> = {
  Approved: { icon: "text-green-600", badge: "bg-green-50 text-green-700 border-green-200",  bar: "from-green-400 via-green-500 to-green-400"  },
  Rejected: { icon: "text-red-600",   badge: "bg-red-50 text-red-700 border-red-200",        bar: "from-red-400 via-red-500 to-red-400"        },
  Pending:  { icon: "text-amber-600", badge: "bg-amber-50 text-amber-700 border-amber-200",  bar: "from-amber-400 via-amber-500 to-amber-400"  },
};

interface AlreadyReviewedDialogProps {
  record: CoaApprovalRecord;
  regNo: string;
  onContinue: () => void;
  onCancel: () => void;
}

function AlreadyReviewedDialog({ record, regNo, onContinue, onCancel }: AlreadyReviewedDialogProps) {
  const status = record.status as ApprovalStatus;
  const StatusIcon = STATUS_ICON[status] ?? Clock;
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.Pending;

  const reviewedAt = record.reviewedAt
    ? new Date(record.reviewedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
        onClick={onCancel}
      />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="already-reviewed-title"
        className="relative bg-white rounded-3xl shadow-2xl shadow-slate-900/20 w-full max-w-md overflow-hidden"
      >
        {/* Coloured top bar */}
        <div className={`h-1.5 bg-gradient-to-r ${colors.bar}`} />

        {/* Close button */}
        <button
          onClick={onCancel}
          aria-label="Cancel"
          className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors z-10"
        >
          <X size={15} />
        </button>

        <div className="p-7">
          {/* Header row */}
          <div className="flex items-start gap-4 mb-5">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
              <StatusIcon size={22} className={colors.icon} />
            </div>
            <div className="flex-1 min-w-0 pr-6">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                Already reviewed
              </p>
              <h3
                id="already-reviewed-title"
                className="text-slate-900 font-bold text-lg leading-snug"
              >
                This report has a decision on record
              </h3>
            </div>
          </div>

          {/* Status card */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 divide-y divide-slate-100 mb-6">
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] w-24 shrink-0">Reg. No.</span>
              <span className="font-mono text-sm text-slate-900 font-semibold">{regNo}</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] w-24 shrink-0">Status</span>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${colors.badge}`}>
                {status}
              </span>
            </div>
            {record.reviewedBy && (
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] w-24 shrink-0">Reviewed by</span>
                <span className="text-sm text-slate-700">{record.reviewedBy}</span>
              </div>
            )}
            {reviewedAt && (
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em] w-24 shrink-0">Reviewed at</span>
                <span className="text-sm text-slate-700">{reviewedAt}</span>
              </div>
            )}
          </div>

          <p className="text-slate-600 text-sm leading-relaxed mb-6">
            Do you still want to run a new AI review? This will not automatically change
            the existing decision — you can update the approval status after reviewing.
          </p>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={onContinue}
              className="flex-1 flex items-center justify-center gap-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl px-4 py-3 shadow-md shadow-emerald-200 transition-all hover:-translate-y-0.5 active:translate-y-0"
            >
              <Sparkles size={14} />
              Continue review
            </button>
            <button
              onClick={onCancel}
              className="flex-1 text-sm font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-400 rounded-xl px-4 py-3 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onResult: (bundle: RegNoReviewBundle) => void;
  initialRegNo?: string; // ← pre-filled from URL param
}

const STEPS = [
  { icon: Database,  label: "Querying LIMS",        sub: "Fetching report rows from the database" },
  { icon: BookOpen,  label: "Reading the report",   sub: "Parsing parameters, results, and metadata" },
  { icon: Sparkles,  label: "Running AI analysis",  sub: "Claude is reviewing every parameter" },
  { icon: BarChart3, label: "Generating findings",  sub: "Compiling the review report" },
];

export default function RegNoEntryPage({ onBack, onResult, initialRegNo }: Props) {
  const [regNo, setRegNo] = useState(initialRegNo ?? "");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Pre-check state
  const [checking, setChecking] = useState(false);
  const [guardRecord, setGuardRecord] = useState<CoaApprovalRecord | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // ── Core review runner (called after any guard is dismissed) ────────────────
  const runReview = useCallback(async (trimmed: string) => {
    setLoading(true);
    setStep(0);
    setError(null);
    setShowDetails(false);
    setGuardRecord(null);

    const interval = setInterval(() => {
      setStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
    }, 6000);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const bundle = await runRegNoReview(trimmed, controller.signal);
      clearInterval(interval);
      setStep(STEPS.length - 1);
      setLoading(false);
      onResult(bundle);
    } catch (err) {
      clearInterval(interval);
      setLoading(false);
      if (controller.signal.aborted) return;
      console.error("[RegNoReview] request failed:", err);
      setError(toFriendlyError(err));
    }
  }, [onResult]);

  // ── Entry point: pre-check approval status first ────────────────────────────
  const startReview = useCallback(async (overrideRegNo?: string) => {
    const trimmed = (overrideRegNo ?? regNo).trim();
    if (!trimmed || loading || checking) return;

    setChecking(true);
    setError(null);
    try {
      const record = await getApproval(trimmed);
      setChecking(false);

      // If there is an existing Approved or Rejected record, show the guard dialog.
      // Pending (or null = never reviewed) flows straight through.
      if (record && (record.status === "Approved" || record.status === "Rejected")) {
        // Make sure the input reflects the value we're about to guard
        setRegNo(trimmed);
        setGuardRecord(record);
        return;
      }
    } catch {
      // Non-fatal — network hiccup on the pre-check should not block the review
      setChecking(false);
    }

    await runReview(trimmed);
  }, [regNo, loading, checking, runReview]);

  // ── Auto-trigger when a reg number arrives from the URL ─────────────────────
  useEffect(() => {
    if (initialRegNo?.trim()) {
      startReview(initialRegNo.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once on mount only

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && regNo.trim()) startReview();
  };

  const isBusy = loading || checking;

  return (
    <div className="min-h-screen bg-[#f8f9fc] flex flex-col">
      {/* Nav */}
      <nav className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              disabled={isBusy}
              className="flex items-center gap-2 text-slate-500 hover:text-slate-900 transition-colors text-sm font-medium disabled:opacity-40"
            >
              <ArrowLeft size={15} />
              Back
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

          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Dashboard</span>
            <span className="text-slate-300">›</span>
            <span className="text-emerald-700 font-semibold">Reg. Number</span>
            <span className="text-slate-300">›</span>
            <span className="text-slate-400">Review</span>
          </div>
        </div>
      </nav>

      {/* Body */}
      <div className="flex-1 max-w-3xl mx-auto w-full px-6 py-16">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-4 py-1.5 mb-5">
            <Database size={11} />
            LIMS database lookup
          </div>
          <h1 className="text-4xl font-bold text-slate-900 leading-tight tracking-tight mb-3">
            Enter a registration number
          </h1>
          <p className="text-slate-500 text-sm">
            We&rsquo;ll pull the report from the LIMS database and run the same AI review as the file flow.
          </p>
        </div>

        {/* Reg No card */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-7">
          <label htmlFor="regno-input" className="block text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">
            LIMS Registration No.
          </label>
          <div className="relative">
            <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              id="regno-input"
              type="text"
              autoFocus={!initialRegNo} // don't steal focus if we're auto-submitting
              value={regNo}
              onChange={(e) => setRegNo(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. EFRAC/.../..."
              disabled={isBusy}
              className="w-full pl-11 pr-4 py-3.5 rounded-2xl border border-slate-200 text-slate-900 font-mono text-sm placeholder:text-slate-300 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>
          <p className="text-[11px] text-slate-400 mt-2.5">
            The number printed on the report cover, e.g. <span className="font-mono">LIMS-2025-0042</span>.
          </p>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">What we fetch</p>
              <p className="text-xs text-slate-600">Header + every parameter row from Trn105 ⨝ Trn205.</p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">What you can do</p>
              <p className="text-xs text-slate-600">Modify wrong results inline — saves back to the LIMS DB.</p>
            </div>
          </div>

          <button
            onClick={() => startReview()}
            disabled={!regNo.trim() || isBusy}
            className={`
              mt-6 w-full rounded-2xl py-4 font-bold text-sm flex items-center justify-center gap-2.5
              transition-all duration-300
              ${regNo.trim() && !isBusy
                ? "bg-emerald-600 hover:bg-emerald-700 text-white hover:-translate-y-0.5 active:translate-y-0"
                : "bg-slate-100 text-slate-400 cursor-not-allowed"}
            `}
          >
            {checking ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                Checking status…
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Run AI review
              </>
            )}
          </button>
          <p className="text-center text-[11px] text-slate-400 mt-2">
            Takes 30–90 seconds.
          </p>
        </div>
      </div>

      {/* ── Already-reviewed guard dialog ───────────────────────────────────── */}
      {guardRecord && (
        <AlreadyReviewedDialog
          record={guardRecord}
          regNo={regNo.trim()}
          onContinue={() => runReview(regNo.trim())}
          onCancel={() => setGuardRecord(null)}
        />
      )}

      {/* ── Error Modal ─────────────────────────────────────────────────────── */}
      {error && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" onClick={() => setError(null)} />
          <div
            role="alertdialog"
            aria-modal="true"
            className="relative bg-white rounded-3xl shadow-2xl shadow-slate-900/20 w-full max-w-lg overflow-hidden"
          >
            <div className="h-1.5 bg-gradient-to-r from-red-400 via-red-500 to-red-400" />
            <button
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors z-10"
            >
              <X size={15} />
            </button>

            <div className="relative p-7">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
                  <AlertTriangle size={22} className="text-red-500" />
                </div>
                <div className="flex-1 min-w-0 pr-6">
                  <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1.5">
                    Review failed
                  </p>
                  <h3 className="text-slate-900 font-bold text-lg leading-snug mb-2">{error.title}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{error.description}</p>
                </div>
              </div>

              {error.hint && (
                <div className="mt-5 flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                  <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle2 size={11} className="text-blue-600" />
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">{error.hint}</p>
                </div>
              )}

              <div className="mt-6 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startReview()}
                    disabled={isBusy}
                    className="flex items-center gap-1.5 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-xl px-4 py-2.5 shadow-md shadow-red-200 transition-all hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50"
                  >
                    <RefreshCw size={13} />
                    Try again
                  </button>
                  <button
                    onClick={() => setError(null)}
                    className="text-sm font-semibold text-slate-500 hover:text-slate-800 rounded-xl px-3 py-2.5 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
                {(error.code || error.correlationId) && (
                  <button
                    onClick={() => setShowDetails((s) => !s)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-2 py-1.5 transition-colors"
                  >
                    {showDetails ? "Hide details" : "Show details"}
                  </button>
                )}
              </div>

              {showDetails && (error.code || error.correlationId) && (
                <div className="mt-4 grid gap-2 text-[11px] bg-slate-50 border border-slate-200 rounded-xl p-3.5 font-mono">
                  {error.code && (
                    <div className="flex gap-3">
                      <span className="text-slate-400 shrink-0 w-12">code</span>
                      <span className="text-slate-700 break-all">{error.code}</span>
                    </div>
                  )}
                  {error.correlationId && (
                    <div className="flex gap-3">
                      <span className="text-slate-400 shrink-0 w-12">trace</span>
                      <span className="text-slate-700 break-all">{error.correlationId}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Loading Overlay ─────────────────────────────────────────────────── */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-md" />
          <div className="relative bg-white rounded-3xl shadow-2xl shadow-slate-900/20 w-full max-w-md mx-6 p-8 overflow-hidden">
            <div className="relative flex items-center justify-center mb-8">
              <div className="absolute w-24 h-24 rounded-full border-4 border-emerald-100 animate-ping opacity-30" />
              <div className="w-20 h-20 rounded-full border-4 border-slate-200 border-t-emerald-600 animate-spin" />
              <div className="absolute w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center">
                <Sparkles size={18} className="text-white animate-pulse" />
              </div>
            </div>

            <h3 className="text-xl font-bold text-slate-900 text-center mb-1">Reviewing Report</h3>
            <p className="text-slate-500 text-sm text-center mb-8">
              Claude AI is reviewing <span className="font-mono">{regNo}</span>
            </p>

            <div className="space-y-3">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                const state = i < step ? "done" : i === step ? "active" : "idle";
                return (
                  <div
                    key={i}
                    className={`
                      flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-500
                      ${state === "active" ? "bg-emerald-600 text-white scale-[1.02]" : ""}
                      ${state === "done"   ? "bg-slate-50 border border-slate-200" : ""}
                      ${state === "idle"   ? "bg-slate-50 border border-slate-200 opacity-50" : ""}
                    `}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      state === "active" ? "bg-white/15" : "bg-slate-200"
                    }`}>
                      {state === "done"
                        ? <CheckCircle2 size={16} className="text-slate-700" />
                        : <Icon size={16} className={state === "active" ? "text-white animate-pulse" : "text-slate-400"} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold truncate ${
                        state === "active" ? "text-white" :
                        state === "done"   ? "text-slate-700" : "text-slate-400"
                      }`}>{s.label}</p>
                      <p className={`text-[10px] ${
                        state === "active" ? "text-emerald-50" :
                        state === "done"   ? "text-slate-500" : "text-slate-400"
                      }`}>{s.sub}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-600 rounded-full transition-all duration-700 ease-out"
                style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
              />
            </div>
            <p className="text-center text-[11px] text-slate-400 mt-2">
              {Math.round(((step + 1) / STEPS.length) * 99)}% complete
            </p>
          </div>
        </div>
      )}
    </div>
  );
}