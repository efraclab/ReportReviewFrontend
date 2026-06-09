import {
  FileText,
  Sparkles,
  ArrowRight,
  CloudUpload,
  Database,
  Zap,
  Shield,
  CheckCircle,
  LogOut,
  User,
  ChevronDown,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface Props {
  onPickFiles: () => void;
  onPickRegNo: () => void;
  onLogout: () => void;
}

const FEATURES = [
  { icon: Zap,      label: "Fast Review",  desc: "AI-graded in under a minute" },
  { icon: Shield,   label: "Confidential", desc: "Reports never stored permanently" },
  { icon: Sparkles, label: "AI-Powered",   desc: "Claude analyses every parameter" },
];

function getUserInfo() {
  return {
    employeeId:  localStorage.getItem("EmployeeId")  || "—",
    username:    localStorage.getItem("Username")    || "User",
    designation:  localStorage.getItem("Designation")  || "—",
    role:        localStorage.getItem("Role")        || "—",
  };
}

/** Returns the user's initials (up to 2 chars) from the stored username. */
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

export default function DashboardPage({ onPickFiles, onPickRegNo, onLogout }: Props) {
  const user = getUserInfo();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /* Close dropdown when clicking outside */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="min-h-screen bg-white">
      {/* ── Nav ─────────────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-30 border-b border-slate-100 bg-white/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">

          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <FileText size={15} className="text-white" />
            </div>
            <span className="font-bold text-slate-900 text-lg tracking-tight">LIMS Review</span>
            <span className="text-[11px] font-semibold bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full">AI</span>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-4">
            {/* Online indicator */}
            <div className="hidden sm:flex items-center gap-1.5 text-sm text-slate-400">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              AI systems online
            </div>

            {/* User menu */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2.5 pl-1 pr-3 py-1 rounded-full border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-all duration-150"
              >
                {/* Avatar */}
                <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-white leading-none">
                    {initials(user.username)}
                  </span>
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-xs font-semibold text-slate-800 leading-tight">{user.username}</p>
                  <p className="text-[10px] text-slate-400 leading-tight">{user.role}</p>
                </div>
                <ChevronDown
                  size={13}
                  className={`text-slate-400 transition-transform duration-200 ${menuOpen ? "rotate-180" : ""}`}
                />
              </button>

              {/* Dropdown */}
              {menuOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60 overflow-hidden z-50">
                  {/* User info block */}
                  <div className="px-4 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                        <span className="text-sm font-bold text-white">{initials(user.username)}</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{user.username}</p>
                        <p className="text-[11px] text-slate-400">{user.role}</p>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Employee ID</span>
                        <span className="text-[11px] font-semibold text-slate-700">{user.employeeId}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Designation</span>
                        <span className="text-[11px] font-semibold text-slate-700">{user.designation}</span>
                      </div>
                    </div>
                  </div>

                  {/* Logout */}
                  <button
                    onClick={() => { setMenuOpen(false); onLogout(); }}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-red-500 hover:bg-red-50 transition-colors duration-150"
                  >
                    <LogOut size={14} />
                    <span className="font-medium">Sign out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* ── Main ────────────────────────────────────────────────── */}
      <main className="pt-24 pb-20">

        <div className="max-w-3xl mx-auto px-6 text-center mb-12">
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
            Choose how you want to review reports — upload PDF files, or pull a report straight from the LIMS database by its registration number.
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

        {/* Choice cards */}
        <div className="max-w-4xl mx-auto px-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Files */}
          <button
            onClick={onPickFiles}
            className="group relative text-left overflow-hidden rounded-3xl border border-slate-200 bg-white hover:border-blue-400 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 p-7"
          >
            <div className="absolute -top-8 -right-8 w-40 h-40 bg-blue-50 rounded-full blur-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center mb-5 group-hover:rotate-6 transition-transform">
                <CloudUpload size={26} className="text-white" />
              </div>
              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1.5">Option A</p>
              <h2 className="text-2xl font-bold text-slate-900 mb-2 tracking-tight">Review by Files</h2>
              <p className="text-slate-500 text-sm leading-relaxed mb-5">
                Drop one or more PDF lab reports. The AI extracts every field, runs compliance &amp; data-quality checks, and gives you a graded review.
              </p>
              <ul className="space-y-1.5 mb-6">
                {["Drag &amp; drop, up to 5 PDFs", "Compliance gaps highlighted", "Per-finding accept / modify / reject"].map((t) => (
                  <li key={t} className="flex items-center gap-2 text-xs text-slate-600">
                    <CheckCircle size={11} className="text-blue-600 shrink-0" />
                    <span dangerouslySetInnerHTML={{ __html: t }} />
                  </li>
                ))}
              </ul>
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-blue-600 group-hover:gap-2.5 transition-all">
                Upload reports <ArrowRight size={14} />
              </span>
            </div>
          </button>

          {/* Reg No */}
          <button
            onClick={onPickRegNo}
            className="group relative text-left overflow-hidden rounded-3xl border border-slate-200 bg-white hover:border-emerald-400 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 p-7"
          >
            <div className="absolute -top-8 -right-8 w-40 h-40 bg-emerald-50 rounded-full blur-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center mb-5 group-hover:-rotate-6 transition-transform">
                <Database size={24} className="text-white" />
              </div>
              <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest mb-1.5">Option B</p>
              <h2 className="text-2xl font-bold text-slate-900 mb-2 tracking-tight">Review by Registration No.</h2>
              <p className="text-slate-500 text-sm leading-relaxed mb-5">
                Enter a LIMS reg. number — we&rsquo;ll pull the report directly from the database, run the same review, and let you correct wrong values inline.
              </p>
              <ul className="space-y-1.5 mb-6">
                {["Direct LIMS database lookup", "Same AI evaluation heads", "Edit &amp; save wrong results inline"].map((t) => (
                  <li key={t} className="flex items-center gap-2 text-xs text-slate-600">
                    <CheckCircle size={11} className="text-emerald-600 shrink-0" />
                    <span dangerouslySetInnerHTML={{ __html: t }} />
                  </li>
                ))}
              </ul>
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 group-hover:gap-2.5 transition-all">
                Enter reg. number <ArrowRight size={14} />
              </span>
            </div>
          </button>
        </div>

        <p className="text-center text-xs text-slate-400 mt-10">
          Both flows run the same evaluation heads &amp; severity grading.
        </p>
      </main>
    </div>
  );
}