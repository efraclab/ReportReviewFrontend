import { useEffect, useState, useRef, useCallback } from "react";
import {
  CloudUpload,
  FileText,
  X,
  AlertCircle,
  Sparkles,
  Eye,
  Shield,
  Zap,
  CheckCircle,
  Clock,
  Trash2,
  ArrowRight,
  ArrowLeft,
  History,
  File as FileIcon,
} from "lucide-react";
import type { UploadedFile } from "../types/UploadedFile";
import type { StoredReviewMeta } from "../types/StoredReview";
import {
  HISTORY_TTL_DAYS,
  deleteReview,
  listReviewMetas,
} from "../services/reviewHistoryStore";

interface Props {
  onPreview: (files: UploadedFile[]) => void;
  onOpenStoredReview: (id: string) => void;
  onBack?: () => void;
}

const MAX_FILES = 5;
const MAX_MB = 20;

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString();
}

function formatExpiry(expiresAt: number): string {
  const days = Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
  if (days <= 0) return "expires soon";
  return `expires in ${days}d`;
}

const FEATURES = [
  { icon: Zap, label: "Fast Review", desc: "AI-graded in under a minute" },
  { icon: Shield, label: "Confidential", desc: "Reports never stored permanently" },
  { icon: Sparkles, label: "AI-Powered", desc: "Claude analyses every parameter" },
];

export default function UploadPage({ onPreview, onOpenStoredReview, onBack }: Props) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // const [recent, setRecent] = useState<StoredReviewMeta[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // const refreshRecent = useCallback(() => {
  //   listReviewMetas()
  //     .then(setRecent)
  //     .catch((e) => {
  //       console.warn("[history] list failed:", e);
  //       setRecent([]);
  //     });
  // }, []);

  // useEffect(() => {
  //   refreshRecent();
  // }, [refreshRecent]);

  // const handleDeleteRecent = useCallback(
  //   async (id: string) => {
  //     await deleteReview(id).catch((e) =>
  //       console.warn("[history] delete failed:", e),
  //     );
  //     refreshRecent();
  //   },
  //   [refreshRecent],
  // );

  const addFiles = useCallback(
    (raw: FileList | File[]) => {
      setError(null);
      const arr = Array.from(raw);
      const nonPdf = arr.filter((f) => f.type !== "application/pdf");
      if (nonPdf.length) { setError("Only PDF files are supported."); return; }
      const big = arr.filter((f) => f.size > MAX_MB * 1024 * 1024);
      if (big.length) { setError(`Each file must be under ${MAX_MB} MB.`); return; }
      if (files.length + arr.length > MAX_FILES) { setError(`Maximum ${MAX_FILES} files allowed.`); return; }
      const mapped: UploadedFile[] = arr.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        name: f.name,
        size: f.size,
        objectUrl: URL.createObjectURL(f),
      }));
      setFiles((p) => [...p, ...mapped]);
    },
    [files.length]
  );

  const remove = (id: string) => {
    setFiles((p) => {
      const f = p.find((x) => x.id === id);
      if (f?.objectUrl) URL.revokeObjectURL(f.objectUrl);
      return p.filter((x) => x.id !== id);
    });
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-30 border-b border-slate-100 bg-white/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {onBack && (
              <button
                onClick={onBack}
                className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 transition-colors text-sm font-medium"
              >
                <ArrowLeft size={15} />
                Dashboard
              </button>
            )}
            {onBack && <div className="h-5 w-px bg-slate-200" />}
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                <FileText size={15} className="text-white" />
              </div>
              <span className="font-bold text-slate-900 text-lg tracking-tight">LIMS Review</span>
              <span className="text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full">AI</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-slate-400">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" />
            AI systems online
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-20">
        {/* Hero */}
        <div className="max-w-3xl mx-auto px-6 text-center mb-14">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-100 rounded-full px-4 py-1.5 mb-6">
            <Sparkles size={11} />
            Powered by Claude AI
          </div>
          <h1 className="text-5xl font-bold text-slate-900 leading-[1.1] tracking-tight mb-5">
            LIMS Report Review,
            <br />
            <span className="text-slate-500">by AI</span>
          </h1>
          <p className="text-slate-500 text-md leading-relaxed">
            Upload lab test reports and let AI surface every compliance gap, formatting issue, and missing field — in seconds.
          </p>
        </div>

        {/* Feature pills */}
        <div className="mx-auto px-6 flex justify-center gap-4 mb-12 flex-wrap">
          {FEATURES.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
              <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
                <Icon size={13} className="text-blue-600" />
              </div>
              <div>
                <p className="text-slate-800 text-xs font-semibold">{label}</p>
                <p className="text-slate-400 text-[11px]">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Upload Area */}
        <div className="max-w-2xl mx-auto px-6">
          {/* Drop Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => files.length < MAX_FILES && inputRef.current?.click()}
            className={`
              relative rounded-3xl border-2 border-dashed cursor-pointer overflow-hidden
              transition-all duration-300 ease-out
              ${dragging
                ? "border-blue-500 bg-blue-50 scale-[1.02]"
                : files.length >= MAX_FILES
                ? "border-slate-200 bg-slate-50 cursor-not-allowed"
                : "border-slate-300 hover:border-blue-400 hover:bg-blue-50/40 bg-white"
              }
            `}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />

            {/* Background decoration */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className={`absolute -top-8 -right-8 w-40 h-40 rounded-full transition-all duration-500 ${dragging ? "bg-slate-200/60 scale-150" : "bg-slate-100/30"}`} />
              <div className={`absolute -bottom-8 -left-8 w-32 h-32 rounded-full transition-all duration-500 ${dragging ? "bg-slate-200/60 scale-150" : "bg-slate-100/30"}`} />
            </div>

            <div className="relative px-10 py-14 text-center">
              <div className={`
                w-20 h-20 rounded-2xl mx-auto mb-5 flex items-center justify-center
                transition-all duration-300
                ${dragging ? "bg-blue-600 rotate-6 scale-110" : "bg-blue-600"}
              `}>
                <CloudUpload size={32} className="text-white" />
              </div>
              <p className="text-xl font-bold text-slate-800 mb-2">
                {dragging ? "Release to upload" : "Drop PDFs here"}
              </p>
              <p className="text-slate-400 text-sm">
                or{" "}
                <span className="text-blue-600 font-semibold underline underline-offset-2 cursor-pointer">
                  click to browse
                </span>
              </p>
              <div className="mt-6 flex items-center justify-center gap-6 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <CheckCircle size={11} className="text-slate-500" />
                  PDF only
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle size={11} className="text-slate-500" />
                  Up to {MAX_MB} MB each
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle size={11} className="text-slate-500" />
                  Max {MAX_FILES} files
                </span>
              </div>
            </div>
          </div>

          {/* Error — kept red as it's a real error state */}
          {error && (
            <div className="mt-3 flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}

          {/* File List */}
          {files.length > 0 && (
            <div className="mt-5 space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <p className="text-sm font-semibold text-slate-700">
                  Selected Files
                  <span className="ml-2 text-slate-700 text-xs bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full font-semibold">
                    {files.length}/{MAX_FILES}
                  </span>
                </p>
                {files.length > 1 && (
                  <button
                    onClick={() => { files.forEach((f) => f.objectUrl && URL.revokeObjectURL(f.objectUrl)); setFiles([]); }}
                    className="text-xs text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>
              {files.map((f, i) => (
                <div
                  key={f.id}
                  className="group flex items-center gap-4 bg-white border border-slate-200 rounded-2xl px-4 py-3.5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                    <FileText size={17} className="text-slate-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-800 font-semibold text-sm truncate">{f.name}</p>
                    <p className="text-slate-400 text-xs mt-0.5">{formatSize(f.size)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full">
                      Ready
                    </span>
                    <button
                      onClick={() => remove(f.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-slate-700 hover:bg-slate-100 transition-all duration-150 opacity-0 group-hover:opacity-100"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* CTA */}
          <div className="mt-7">
            <button
              onClick={() => files.length > 0 && onPreview(files)}
              disabled={files.length === 0}
              className={`
                w-full relative overflow-hidden rounded-2xl py-4 font-bold text-base
                flex items-center justify-center gap-3
                transition-all duration-300
                ${files.length > 0
                  ? "bg-blue-600 hover:bg-blue-700 text-white hover:-translate-y-0.5 active:translate-y-0"
                  : "bg-slate-100 text-slate-400 cursor-not-allowed"
                }
              `}
            >
              <Eye size={18} />
              {files.length === 0
                ? "Select files to continue"
                : `Preview & Submit — ${files.length} file${files.length > 1 ? "s" : ""}`}
            </button>
            {files.length > 0 && (
              <p className="text-center text-slate-400 text-xs mt-3">
                You can review your reports before starting AI analysis
              </p>
            )}
          </div>

          {/* Recent Reviews — cached locally for {HISTORY_TTL_DAYS} days */}
          {/* {recent && recent.length > 0 && (
            <section className="mt-16">
              <div className="flex items-end justify-between mb-4 px-1">
                <div>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                    <History size={12} />
                    Recent Reviews
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Stored on this device for {HISTORY_TTL_DAYS} days, then auto-removed.
                  </p>
                </div>
                <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                  {recent.length}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {recent.map((r) => {
                  const issuesPct = Math.max(0, Math.min(100, 100 - r.overallScore));
                  const primaryName = r.fileNames[0] ?? "Untitled";
                  const more = r.fileNames.length - 1;
                  return (
                    <div
                      key={r.id}
                      className="group relative bg-white border border-slate-200 rounded-2xl p-4 hover:border-slate-400 hover:shadow-md transition-all duration-200"
                    >
                      <button
                        type="button"
                        onClick={() => onOpenStoredReview(r.id)}
                        className="absolute inset-0 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                        aria-label={`Open review of ${primaryName}${more > 0 ? ` and ${more} more` : ""}`}
                      />
                      <div className="flex items-start gap-3 relative pointer-events-none">
                        <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                          <FileIcon size={16} className="text-slate-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-slate-900 font-semibold text-sm truncate">
                            {primaryName.replace(/\.pdf$/i, "")}
                          </p>
                          <p className="text-slate-400 text-[11px] mt-0.5 truncate">
                            {r.fileCount} file{r.fileCount === 1 ? "" : "s"}
                            {more > 0 ? ` • +${more} more` : ""} • {formatSize(r.totalSize)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteRecent(r.id);
                          }}
                          aria-label="Delete this cached review"
                          className="pointer-events-auto relative z-10 w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-slate-700 hover:bg-slate-100 transition-all duration-150 opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <div className="mt-4 flex items-center gap-2 flex-wrap pointer-events-none">
                        <span className="text-[11px] font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                          {issuesPct}% issues
                        </span>
                        {r.errorCount > 0 && (
                          <span className="text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                            {r.errorCount} error{r.errorCount === 1 ? "" : "s"}
                          </span>
                        )}
                        {r.warningCount > 0 && (
                          <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                            {r.warningCount} warn
                          </span>
                        )}
                        {r.suggestionCount > 0 && (
                          <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                            {r.suggestionCount} tip{r.suggestionCount === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 pointer-events-none">
                        <span className="flex items-center gap-1">
                          <Clock size={11} />
                          {formatRelative(r.createdAt)}
                        </span>
                        <span className="flex items-center gap-1 text-slate-600 font-semibold">
                          {formatExpiry(r.expiresAt)}
                          <ArrowRight size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )} */}
        </div>
      </main>
    </div>
  );
}