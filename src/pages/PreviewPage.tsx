import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  FileText,
  Sparkles,
  File,
  BookOpen,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
} from "lucide-react";
import type { ReviewResult } from "../types/ReviewResult";
import type { UploadedFile } from "../types/UploadedFile";
import PdfViewer from "./PdfViewer";
import { runPdfReview, PdfReviewError } from "../services/pdfReviewClient";
import { saveReview } from "../services/reviewHistoryStore";

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

    // Special-case: Anthropic billing / credit exhaustion
    if (lower.includes("credit balance") || lower.includes("billing")) {
      return {
        title: "AI service unavailable — billing issue",
        description:
          "The AI provider can't process this request right now because the account credit balance is too low. This is a configuration issue on the server, not with your file.",
        hint: "Please contact your administrator to top up the AI provider account, then try again.",
        code: err.errorCode,
        correlationId: err.correlationId,
      };
    }

    switch (err.errorCode) {
      case "VALIDATION_ERROR":
        return {
          title: "We couldn't accept that request",
          description:
            "The server rejected one or more of the uploaded files or fields. Please check that every file is a valid PDF under 32 MB.",
          hint: msg || undefined,
          code: err.errorCode,
          correlationId: err.correlationId,
        };
      case "AI_RATE_LIMIT":
        return {
          title: "Too many reviews right now",
          description:
            "We've hit the AI provider's rate limit. Please wait a moment and try again.",
          code: err.errorCode,
          correlationId: err.correlationId,
        };
      case "AI_TIMEOUT":
        return {
          title: "AI took too long to respond",
          description:
            "The review request timed out. Large or complex PDFs can take longer — try again, or split the documents into smaller batches.",
          code: err.errorCode,
          correlationId: err.correlationId,
        };
      case "ANTHROPIC_AUTH_FAILURE":
        return {
          title: "AI service authentication failed",
          description:
            "The server couldn't authenticate with the AI provider. This is a server-side configuration issue.",
          hint: "Please contact your administrator.",
          code: err.errorCode,
          correlationId: err.correlationId,
        };
      case "INTERNAL_ERROR":
        return {
          title: "Something went wrong on our side",
          description:
            "The server hit an unexpected error while processing your review. Please try again in a moment.",
          code: err.errorCode,
          correlationId: err.correlationId,
        };
      default:
        // AI_API_ERROR_* and any other backend code
        if (err.errorCode?.startsWith("AI_API_ERROR")) {
          return {
            title: "AI provider returned an error",
            description:
              "The upstream AI service couldn't complete this review. This is usually temporary — please try again.",
            hint: msg || undefined,
            code: err.errorCode,
            correlationId: err.correlationId,
          };
        }
        return {
          title: "Review failed",
          description: msg || "An unexpected error occurred while reviewing your PDFs.",
          code: err.errorCode,
          correlationId: err.correlationId,
        };
    }
  }

  if (err instanceof TypeError) {
    // fetch network failures surface as TypeError in browsers
    return {
      title: "Network error",
      description:
        "We couldn't reach the review server. Check your internet connection and confirm the backend is running.",
    };
  }

  if (err instanceof Error) {
    return {
      title: "Review failed",
      description: err.message || "An unexpected error occurred.",
    };
  }

  return {
    title: "Review failed",
    description: "An unexpected error occurred while reviewing your PDFs.",
  };
}

interface Props {
  files: UploadedFile[];
  onBack: () => void;
  onResult: (result: ReviewResult, metadata: import("../services/pdfReviewClient").ReportMetadata[], correlationId: string, model: string) => void;
}

const STEPS = [
  { icon: BookOpen,     label: "Reading documents",    sub: "Parsing PDF content and structure" },
  { icon: FileText,     label: "Extracting content",   sub: "Analyzing text, tables, and metadata" },
  { icon: Sparkles,     label: "Running AI analysis",  sub: "Claude is reviewing every detail" },
  { icon: BarChart3,    label: "Generating report",    sub: "Compiling findings and suggestions" },
];

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function PreviewPage({ files, onBack, onResult }: Props) {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [activePreview, setActivePreview] = useState(0);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const startReview = async () => {
    setLoading(true);
    setStep(0);
    setError(null);
    setShowDetails(false);

    // Real Claude PDF reviews take ~30–90s; advance the indicator slowly
    // so the UI keeps visible motion through each stage.
    const interval = setInterval(() => {
      setStep((s) => (s < STEPS.length - 1 ? s + 1 : s));
    }, 8000);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { result, correlationId, model, metadata } = await runPdfReview(
        files.map((f) => ({ id: f.id, name: f.name, file: f.file })),
        controller.signal,
      );
      clearInterval(interval);
      setStep(STEPS.length - 1);

      // Cache the review (PDFs + result) for the dashboard's recent list.
      // Non-blocking from a UX standpoint — log and continue if it fails.
    //   try {
    //     await saveReview({
    //       result,
    //       correlationId,
    //       model,
    //       files: files.map((f) => ({
    //         id: f.id,
    //         name: f.name,
    //         size: f.size,
    //         type: f.file.type,
    //         blob: f.file,
    //       })),
    //     });
    //   } catch (cacheErr) {
    //     console.warn("[PdfReview] failed to cache review:", cacheErr);
    //   }

      setLoading(false);
      onResult(result, metadata, correlationId, model);
    } catch (err) {
      clearInterval(interval);
      setLoading(false);
      if (controller.signal.aborted) return;
      // Surface raw failure for debugging; user sees the friendly version below.
      console.error("[PdfReview] request failed:", err);
      setError(toFriendlyError(err));
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fc] flex flex-col">
      {/* Nav */}
      <nav className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              disabled={loading}
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

          {/* Step breadcrumb */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-400">Upload</span>
            <span className="text-slate-300">›</span>
            <span className="text-blue-600 font-semibold">Preview</span>
            <span className="text-slate-300">›</span>
            <span className="text-slate-400">Review</span>
          </div>
        </div>
      </nav>

      {/* Main */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-6 py-8 grid grid-cols-5 gap-6">
        {/* LEFT — file sidebar */}
        <aside className="col-span-1 flex flex-col gap-3">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest px-1 mb-1">
            Files ({files.length})
          </p>
          {files.map((f, i) => (
            <button
              key={f.id}
              onClick={() => setActivePreview(i)}
              className={`
                w-full text-left rounded-2xl p-3 border transition-all duration-200
                ${activePreview === i
                  ? "bg-blue-600 border-blue-600"
                  : "bg-white border-slate-200 hover:border-slate-400 hover:bg-slate-50"
                }
              `}
            >
              <div className="flex items-center gap-2.5 mb-2">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${activePreview === i ? "bg-white/15" : "bg-slate-100"}`}>
                  <File size={14} className={activePreview === i ? "text-white" : "text-slate-500"} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-[11px] font-bold truncate ${activePreview === i ? "text-white" : "text-slate-700"}`}>
                    {f.name.replace(/\.pdf$/i, "")}
                  </p>
                  <p className={`text-[10px] ${activePreview === i ? "text-slate-300" : "text-slate-400"}`}>
                    {formatSize(f.size)}
                  </p>
                </div>
              </div>
              <div className={`text-[10px] font-semibold flex items-center gap-1 ${activePreview === i ? "text-slate-300" : "text-slate-500"}`}>
                <CheckCircle2 size={9} />
                Ready for review
              </div>
            </button>
          ))}
        </aside>

        {/* CENTER — PDF pages rendered directly */}
        <div className="col-span-3 flex flex-col min-h-0">
          {/* Toolbar */}
          <div className="flex items-center justify-between mb-3 px-1 shrink-0">
            <div className="flex items-center gap-2">
              <File size={14} className="text-slate-500" />
              <p className="text-sm font-semibold text-slate-700 truncate max-w-xs">
                {files[activePreview]?.name}
              </p>
            </div>
            <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
              {activePreview + 1} / {files.length}
            </span>
          </div>

          {/* Scrollable page canvas area */}
          <div className="flex-1 rounded-3xl overflow-y-auto border border-slate-200 shadow-xl shadow-slate-200/50 bg-[#f0f2f5]" style={{ maxHeight: "calc(100vh - 200px)" }}>
            {files[activePreview]?.objectUrl ? (
              <PdfViewer
                key={files[activePreview].id}
                url={files[activePreview].objectUrl!}
                fileName={files[activePreview].name}
                scale={1.5}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
                <File size={48} className="text-slate-300" />
                <p className="text-sm">Preview not available</p>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — summary + action */}
        <div className="col-span-1 flex flex-col gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Summary</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Total Files</span>
                <span className="text-sm font-bold text-slate-900">{files.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Total Size</span>
                <span className="text-sm font-bold text-slate-900">
                  {formatSize(files.reduce((s, f) => s + f.size, 0))}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Format</span>
                <span className="text-sm font-bold text-slate-900">PDF</span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-[11px] text-slate-400 text-center">
                Files are processed securely and never stored permanently.
              </p>
            </div>
          </div>

          {/* What AI checks */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">AI will check</p>
            <div className="space-y-2.5">
              {[
                "Test result completeness",
                "Method, LOQ & UOM consistency",
                "Required fields & metadata",
                "Date, batch & lot numbers",
                "Regulatory compliance",
                "Signatures & authorization",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 text-xs text-slate-600">
                  <div className="w-4 h-4 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                    <CheckCircle2 size={9} className="text-blue-600" />
                  </div>
                  {item}
                </div>
              ))}
            </div>
          </div>

          {/* Review Button */}
          <button
            onClick={startReview}
            disabled={loading}
            className="w-full rounded-2xl py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm
              flex items-center justify-center gap-2.5
              transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Sparkles size={16} />
            Review with AI
          </button>
          <p className="text-center text-[11px] text-slate-400 -mt-2">
            Takes 30–90 seconds per report
          </p>
        </div>
      </div>

      {/* Error Modal */}
      {error && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
            onClick={() => setError(null)}
          />

          {/* Modal */}
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="review-error-title"
            aria-describedby="review-error-desc"
            className="relative bg-white rounded-3xl shadow-2xl shadow-slate-900/20 w-full max-w-lg overflow-hidden"
          >
            {/* Top accent stripe */}
            <div className="h-1.5 bg-gradient-to-r from-red-400 via-red-500 to-red-400" />

            {/* Decorative glow */}
            <div className="absolute -top-12 -right-12 w-40 h-40 bg-red-400/15 rounded-full blur-2xl pointer-events-none" />
            <div className="absolute -bottom-12 -left-12 w-32 h-32 bg-rose-400/10 rounded-full blur-2xl pointer-events-none" />

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
                  <h3
                    id="review-error-title"
                    className="text-slate-900 font-bold text-lg leading-snug mb-2"
                  >
                    {error.title}
                  </h3>
                  <p
                    id="review-error-desc"
                    className="text-slate-600 text-sm leading-relaxed"
                  >
                    {error.description}
                  </p>
                </div>
              </div>

              {error.hint && (
                <div className="mt-5 flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                  <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle2 size={11} className="text-blue-600" />
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {error.hint}
                  </p>
                </div>
              )}

              <div className="mt-6 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={startReview}
                    disabled={loading}
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

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Blurred backdrop */}
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-md" />

          {/* Modal */}
          <div className="relative bg-white rounded-3xl shadow-2xl shadow-slate-900/20 w-full max-w-md mx-6 p-8 overflow-hidden">
            {/* Spinner */}
            <div className="relative flex items-center justify-center mb-8">
              <div className="absolute w-24 h-24 rounded-full border-4 border-blue-100 animate-ping opacity-30" />
              <div className="w-20 h-20 rounded-full border-4 border-slate-200 border-t-blue-600 animate-spin" />
              <div className="absolute w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
                <Sparkles size={18} className="text-white animate-pulse" />
              </div>
            </div>

            <h3 className="text-xl font-bold text-slate-900 text-center mb-1">
              Analyzing Reports
            </h3>
            <p className="text-slate-500 text-sm text-center mb-8">
              Claude AI is reviewing your {files.length} report{files.length > 1 ? "s" : ""}
            </p>

            {/* Steps */}
            <div className="space-y-3">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                const state = i < step ? "done" : i === step ? "active" : "idle";
                return (
                  <div
                    key={i}
                    className={`
                      flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-500
                      ${state === "active" ? "bg-blue-600 text-white scale-[1.02]" : ""}
                      ${state === "done"   ? "bg-slate-50 border border-slate-200" : ""}
                      ${state === "idle"   ? "bg-slate-50 border border-slate-200 opacity-50" : ""}
                    `}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      state === "active" ? "bg-white/15" :
                      state === "done"   ? "bg-slate-200" :
                                           "bg-slate-200"
                    }`}>
                      {state === "done"
                        ? <CheckCircle2 size={16} className="text-slate-700" />
                        : <Icon size={16} className={state === "active" ? "text-white animate-pulse" : "text-slate-400"} />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold truncate ${
                        state === "active" ? "text-white" :
                        state === "done"   ? "text-slate-700" :
                                             "text-slate-400"
                      }`}>{s.label}</p>
                      <p className={`text-[10px] ${
                        state === "active" ? "text-slate-300" :
                        state === "done"   ? "text-slate-500" :
                                             "text-slate-400"
                      }`}>{s.sub}</p>
                    </div>
                    {state === "active" && (
                      <div className="flex gap-0.5 shrink-0">
                        {[0, 1, 2].map((d) => (
                          <div key={d} className="w-1 h-1 rounded-full bg-white/70 animate-bounce"
                            style={{ animationDelay: `${d * 120}ms` }} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Progress bar */}
            <div className="mt-6 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-700 ease-out"
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